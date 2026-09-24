/*
 * pulseagent - Lodestar edge telemetry agent (C99, no external deps)
 *
 * Collects real host metrics from the Linux /proc interface and ships them
 * to a Lodestar ingest-gateway over HTTP:
 *
 *   cpu.usage   - busy % across all cores (delta between samples)
 *   mem.used    - used % (MemTotal - MemAvailable)
 *   mem.used.gb - used GB
 *   load.1m     - 1-minute load average
 *   net.rx.kbps / net.tx.kbps - network throughput (KB/s)
 *
 * Build:  make            (see Makefile)
 * Run:    ./pulseagent    (env-configurable, see below)
 *
 * Environment:
 *   PULSE_GATEWAY_URL   default http://127.0.0.1:3100
 *   PULSE_INTERVAL_MS   default 2000
 *   PULSE_API_KEY       default pg_live_demo_key
 *
 * The agent is intentionally dependency-free and statically linkable so it
 * can run on the smallest VMs, containers and edge boxes (ADR-001).
 */

#include <ctype.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/sysinfo.h>
#include <sys/time.h>
#include <netdb.h>

#define HOST_MAX 256
#define BODY_MAX 4096

static volatile sig_atomic_t g_run = 1;

static void on_signal(int sig) { (void)sig; g_run = 0; }

static long long now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long long)ts.tv_sec * 1000LL + ts.tv_nsec / 1000000LL;
}

static void msleep(long ms)
{
    struct timespec ts = { .tv_sec = ms / 1000, .tv_nsec = (ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}

/* ---------- /proc sampling ------------------------------------------------ */

struct CpuSample { long long idle, total; };

static int read_cpu(struct CpuSample *out)
{
    FILE *f = fopen("/proc/stat", "r");
    if (!f) return -1;
    char line[512];
    long long idle = 0, total = 0;
    int ok = 0;
    while (fgets(line, sizeof line, f)) {
        if (strncmp(line, "cpu ", 4) == 0) {
            long long user, nice, sys, idle_t, iowait, irq, softirq, steal;
            if (sscanf(line + 4, "%lld %lld %lld %lld %lld %lld %lld %lld",
                       &user, &nice, &sys, &idle_t, &iowait, &irq, &softirq, &steal) >= 4) {
                idle = idle_t + iowait;
                total = user + nice + sys + idle_t + iowait + irq + softirq + steal;
                ok = 1;
            }
            break;
        }
    }
    fclose(f);
    out->idle = idle;
    out->total = total;
    return ok ? 0 : -1;
}

struct MemSample { double used_pct, used_gb; };

static int read_mem(struct MemSample *out)
{
    FILE *f = fopen("/proc/meminfo", "r");
    if (!f) return -1;
    char key[64];
    long kb;
    long total = -1, available = -1;
    char line[256];
    while (fgets(line, sizeof line, f)) {
        if (sscanf(line, "%63s %ld", key, &kb) == 2) {
            if (strcmp(key, "MemTotal:") == 0) total = kb;
            else if (strcmp(key, "MemAvailable:") == 0) available = kb;
        }
    }
    fclose(f);
    if (total <= 0 || available < 0) return -1;
    long used = total - available;
    out->used_gb = used / 1048576.0;
    out->used_pct = 100.0 * used / (double)total;
    return 0;
}

struct NetSample { long long rx, tx; };

static int read_net(struct NetSample *out)
{
    FILE *f = fopen("/proc/net/dev", "r");
    if (!f) return -1;
    char line[512];
    long long rx = 0, tx = 0;
    while (fgets(line, sizeof line, f)) {
        char ifname[64];
        long long rb, tb;
        char *colon = strchr(line, ':');
        if (!colon) continue;
        *colon = '\0';
        sscanf(line, "%63s", ifname);
        if (strcmp(ifname, "lo") == 0) continue;
        if (sscanf(colon + 1, "%lld %*s %*s %*s %*s %*s %*s %*s %lld",
                   &rb, &tb) >= 2) {
            rx += rb;
            tx += tb;
        }
    }
    fclose(f);
    out->rx = rx;
    out->tx = tx;
    return 0;
}

/* ---------- HTTP client (plaintext, local gateway) ------------------------- */

/* Parses scheme://host[:port] from url; returns 0 on success. */
static int parse_host_port(const char *url, char *host, size_t hostsz, int *port)
{
    const char *p = strstr(url, "://");
    if (!p) return -1;
    p += 3;
    const char *slash = strchr(p, '/');
    const char *colon = strchr(p, ':');
    size_t n = (colon && (!slash || colon < slash)) ? (size_t)(colon - p)
                                                    : (slash ? (size_t)(slash - p) : strlen(p));
    if (n == 0 || n >= hostsz) return -1;
    memcpy(host, p, n);
    host[n] = '\0';
    *port = 80;
    if (colon && (!slash || colon < slash)) *port = atoi(colon + 1);
    return 0;
}

static int post_json(const char *url, const char *api_key, const char *body)
{
    char host[HOST_MAX];
    int port;
    if (parse_host_port(url, host, sizeof host, &port) != 0) return -1;

    struct hostent *he = gethostbyname(host);
    if (!he) return -1;

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;

    struct timeval tv = { .tv_sec = 3, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)port);
    memcpy(&addr.sin_addr, he->h_addr_list[0], (size_t)he->h_length);

    if (connect(fd, (struct sockaddr *)&addr, sizeof addr) != 0) {
        close(fd);
        return -1;
    }

    char req[BODY_MAX];
    int req_len = snprintf(req, sizeof req,
        "POST /v1/ingest/metrics HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "x-api-key: %s\r\n"
        "content-type: application/json\r\n"
        "content-length: %zu\r\n"
        "connection: close\r\n"
        "\r\n"
        "%s",
        host, port, api_key, strlen(body), body);

    int status = -1;
    if (write(fd, req, (size_t)req_len) >= 0) {
        char resp[256];
        ssize_t n = read(fd, resp, sizeof resp - 1);
        if (n > 0) {
            resp[n] = '\0';
            if (strncmp(resp, "HTTP/1.1 ", 9) == 0 || strncmp(resp, "HTTP/1.0 ", 9) == 0)
                status = atoi(resp + 9);
        }
    }
    close(fd);
    return (status >= 200 && status < 300) ? 0 : -1;
}

/* ---------- metric emission ------------------------------------------------ */

static void emit_metric(char *buf, size_t bufsz, int *first, const char *name,
                        double value, const char *host)
{
    int n = strlen(buf);
    snprintf(buf + n, bufsz - (size_t)n,
             "%s{\"name\":\"%s\",\"value\":%.2f,\"tags\":{\"host\":\"%s\",\"source\":\"agent\"},\"ts\":%lld}",
             *first ? "" : ",", name, value, host, now_ms());
    *first = 0;
}

int main(void)
{
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGPIPE, SIG_IGN);

    const char *url = getenv("PULSE_GATEWAY_URL");
    if (!url || !*url) url = "http://127.0.0.1:3100";
    const char *api_key = getenv("PULSE_API_KEY");
    if (!api_key || !*api_key) api_key = "pg_live_demo_key";
    long interval = 2000;
    if (getenv("PULSE_INTERVAL_MS")) interval = atol(getenv("PULSE_INTERVAL_MS"));
    if (interval < 250) interval = 250;

    char host[HOST_MAX] = "localhost";
    if (gethostname(host, sizeof host - 1) != 0) strcpy(host, "localhost");

    struct CpuSample prev_cpu = {0, 0};
    struct NetSample prev_net = {0, 0};
    int have_prev = 0;
    int consecutive_failures = 0;

    fprintf(stderr, "[pulseagent] shipping to %s every %ldms as host=%s\n", url, interval, host);

    while (g_run) {
        struct CpuSample cpu;
        struct MemSample mem;
        struct NetSample net;

        if (read_cpu(&cpu) == 0 && read_mem(&mem) == 0 && read_net(&net) == 0) {
            char body[BODY_MAX];
            int first = 1;
            strcpy(body, "{\"metrics\":[");

            if (have_prev) {
                long long dtot = cpu.total - prev_cpu.total;
                long long didle = cpu.idle - prev_cpu.idle;
                if (dtot > 0) {
                    double usage = 100.0 * (double)(dtot - didle) / (double)dtot;
                    emit_metric(body, sizeof body, &first, "cpu.usage", usage, host);
                }
                long long drx = net.rx - prev_net.rx;
                long long dtx = net.tx - prev_net.tx;
                double secs = (double)interval / 1000.0;
                if (secs > 0) {
                    emit_metric(body, sizeof body, &first, "net.rx.kbps", (double)drx / 1024.0 / secs, host);
                    emit_metric(body, sizeof body, &first, "net.tx.kbps", (double)dtx / 1024.0 / secs, host);
                }
            }
            emit_metric(body, sizeof body, &first, "mem.used", mem.used_pct, host);
            emit_metric(body, sizeof body, &first, "mem.used.gb", mem.used_gb, host);

            FILE *f = fopen("/proc/loadavg", "r");
            if (f) {
                double l1;
                if (fscanf(f, "%lf", &l1) == 1)
                    emit_metric(body, sizeof body, &first, "load.1m", l1, host);
                fclose(f);
            }
            strcat(body, "]}");

            if (have_prev) {
                if (post_json(url, api_key, body) == 0) {
                    consecutive_failures = 0;
                } else {
                    consecutive_failures++;
                    fprintf(stderr, "[pulseagent] post failed (attempt %d): %s\n",
                            consecutive_failures, strerror(errno));
                    /* exponential-ish backoff, capped at 30s extra */
                    long backoff = interval * (1 << (consecutive_failures > 5 ? 5 : consecutive_failures));
                    if (backoff > 30000) backoff = 30000;
                    msleep(backoff);
                }
            }
            prev_cpu = cpu;
            prev_net = net;
            have_prev = 1;
        } else {
            fprintf(stderr, "[pulseagent] failed to read /proc: %s\n", strerror(errno));
        }

        for (long waited = 0; g_run && waited < interval; waited += 100)
            msleep(100);
    }

    fprintf(stderr, "[pulseagent] shutting down cleanly\n");
    return 0;
}

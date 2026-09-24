// Package api wires the HTTP surface of the ingest gateway: batch ingest,
// series query, log query, gateway stats, health and an SSE live stream.
package api

import (
        "encoding/json"
        "log/slog"
        "net/http"
        "runtime"
        "strconv"
        "strings"
        "sync"
        "time"

        "lodestar/ingest/internal/auth"
        "lodestar/ingest/internal/gauge"
        "lodestar/ingest/internal/model"
        "lodestar/ingest/internal/store"
)

// Server holds the gateway dependencies.
type Server struct {
        series  *store.SeriesStore
        logs    *store.LogStore
        agents  *store.AgentTracker
        verifer *auth.Verifier
        rps     *gauge.Gauge // live traffic estimate, fed by the collector
        started time.Time

        subMu sync.Mutex
        subs  map[chan model.LogEntry]struct{}
}

// NewServer constructs the HTTP server core. logCh carries log entries for
// SSE fanout; rps is the collector-owned traffic gauge.
func NewServer(ss *store.SeriesStore, ls *store.LogStore, at *store.AgentTracker,
        v *auth.Verifier, logCh <-chan model.LogEntry, rps *gauge.Gauge) *Server {
        s := &Server{
                series: ss, logs: ls, agents: at, verifer: v, rps: rps,
                started: time.Now(),
                subs:    make(map[chan model.LogEntry]struct{}),
        }
        return s
}

// Handler builds the routed HTTP handler with middleware.
func (s *Server) Handler() http.Handler {
        mux := http.NewServeMux()

        // Ingest + protected reads require a valid API key.
        mux.HandleFunc("POST /v1/ingest/metrics", s.verifer.Middleware(http.HandlerFunc(s.handleIngestMetrics)).ServeHTTP)
        mux.HandleFunc("POST /v1/ingest/logs", s.verifer.Middleware(http.HandlerFunc(s.handleIngestLogs)).ServeHTTP)
        mux.HandleFunc("GET /v1/query/metrics", s.verifer.Middleware(http.HandlerFunc(s.handleQueryMetrics)).ServeHTTP)
        mux.HandleFunc("GET /v1/logs", s.verifer.Middleware(http.HandlerFunc(s.handleLogs)).ServeHTTP)
        mux.HandleFunc("GET /v1/stream", s.verifer.Middleware(http.HandlerFunc(s.handleStream)).ServeHTTP)

        // Liveness/observability stay unauthenticated for load-balancer probes.
        mux.HandleFunc("GET /v1/stats", s.handleStats)
        mux.HandleFunc("GET /v1/health", s.handleHealth)

        return logMiddleware(cors(mux))
}

// ---- middleware -----------------------------------------------------------

type statusRecorder struct {
        http.ResponseWriter
        status int
}

func (r *statusRecorder) WriteHeader(code int) {
        r.status = code
        r.ResponseWriter.WriteHeader(code)
}

// Flush forwards flushes so SSE handlers can stream through the recorder
// (handleStream asserts http.Flusher; without this the assertion fails and
// every /v1/stream request would 500 with "streaming unsupported").
func (r *statusRecorder) Flush() {
        if f, ok := r.ResponseWriter.(http.Flusher); ok {
                f.Flush()
        }
}

func logMiddleware(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                start := time.Now()
                rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
                next.ServeHTTP(rec, r)
                if r.URL.Path != "/v1/health" { // keep probe noise out of logs
                        slog.Info("http", "method", r.Method, "path", r.URL.Path,
                                "status", rec.status, "dur", time.Since(start).Round(time.Microsecond).String())
                }
        })
}

func cors(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                h := w.Header()
                h.Set("access-control-allow-origin", "*")
                h.Set("access-control-allow-methods", "GET, POST, OPTIONS")
                h.Set("access-control-allow-headers", "content-type, x-api-key")
                if r.Method == http.MethodOptions {
                        w.WriteHeader(http.StatusNoContent)
                        return
                }
                next.ServeHTTP(w, r)
        })
}

// ---- helpers --------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
        w.Header().Set("content-type", "application/json")
        w.WriteHeader(status)
        enc := json.NewEncoder(w)
        enc.SetEscapeHTML(false)
        _ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
        writeJSON(w, status, map[string]string{"error": msg})
}

// ---- ingest ---------------------------------------------------------------

func (s *Server) handleIngestMetrics(w http.ResponseWriter, r *http.Request) {
        var batch model.MetricsBatch
        if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
                writeErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
                return
        }
        res := model.IngestResult{}
        for _, m := range batch.Metrics {
                if m.Name == "" || isBadValue(m.Value) {
                        res.Rejected++
                        continue
                }
                if m.TS <= 0 {
                        m.TS = time.Now().UnixMilli()
                }
                if m.Tags == nil {
                        m.Tags = model.Tag{}
                }
                s.series.Add(m)
                s.agents.Touch(m.Tags["host"])
                res.Accepted++
        }
        writeJSON(w, http.StatusOK, res)
}

func isBadValue(v float64) bool {
        return v != v || v > 1e15 || v < -1e15
}

func (s *Server) handleIngestLogs(w http.ResponseWriter, r *http.Request) {
        var batch model.LogsBatch
        if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
                writeErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
                return
        }
        res := model.IngestResult{}
        for _, l := range batch.Logs {
                if l.Message == "" {
                        res.Rejected++
                        continue
                }
                l.Level = strings.ToLower(l.Level)
                if l.Level == "" {
                        l.Level = "info"
                }
                if !model.Levels[l.Level] {
                        res.Rejected++
                        continue
                }
                if l.Service == "" {
                        l.Service = "unknown"
                }
                if l.TS <= 0 {
                        l.TS = time.Now().UnixMilli()
                }
                s.logs.Add(l)
                res.Accepted++
        }
        writeJSON(w, http.StatusOK, res)
}

// ---- query ----------------------------------------------------------------

var rangeDurations = map[string]time.Duration{
        "5m": 5 * time.Minute, "15m": 15 * time.Minute, "30m": 30 * time.Minute,
        "1h": time.Hour, "3h": 3 * time.Hour, "6h": 6 * time.Hour, "24h": 24 * time.Hour,
}

func (s *Server) handleQueryMetrics(w http.ResponseWriter, r *http.Request) {
        q := r.URL.Query()
        names := []string{}
        if raw := q.Get("names"); raw != "" {
                for _, n := range strings.Split(raw, ",") {
                        if n = strings.TrimSpace(n); n != "" {
                                names = append(names, n)
                        }
                }
        }
        if len(names) == 0 {
                writeErr(w, http.StatusBadRequest, "names query parameter is required")
                return
        }
        rangeStr := q.Get("range")
        if rangeStr == "" {
                rangeStr = "30m"
        }
        d, ok := rangeDurations[rangeStr]
        if !ok {
                writeErr(w, http.StatusBadRequest, "range must be one of 5m,15m,30m,1h,3h,6h,24h")
                return
        }
        points, err := strconv.Atoi(q.Get("points"))
        if err != nil || points <= 0 {
                points = 120
        }
        if points > 500 {
                points = 500
        }
        filters := model.Tag{}
        if v := q.Get("service"); v != "" {
                filters["service"] = v
        }
        if v := q.Get("source"); v != "" {
                filters["source"] = v
        }
        from := time.Now().Add(-d).UnixMilli()
        series := s.series.Query(names, filters, from, points)
        writeJSON(w, http.StatusOK, map[string]any{
                "series": series,
                "meta": map[string]any{
                        "range": rangeStr, "from": from, "to": time.Now().UnixMilli(),
                        "points": points, "count": len(series),
                },
        })
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
        q := r.URL.Query()
        limit, err := strconv.Atoi(q.Get("limit"))
        if err != nil || limit <= 0 {
                limit = 200
        }
        if limit > 1000 {
                limit = 1000
        }
        level := strings.ToLower(q.Get("level"))
        if level != "" && !model.Levels[level] {
                writeErr(w, http.StatusBadRequest, "invalid level filter")
                return
        }
        logs, total := s.logs.Query(limit, level, q.Get("service"), q.Get("q"))
        if logs == nil {
                logs = []model.LogEntry{}
        }
        writeJSON(w, http.StatusOK, map[string]any{"logs": logs, "total": total})
}

// ---- stats / health ---------------------------------------------------------

func (s *Server) handleStats(w http.ResponseWriter, _ *http.Request) {
        var ms runtime.MemStats
        runtime.ReadMemStats(&ms)
        writeJSON(w, http.StatusOK, map[string]any{
                "service":             "ingest-gateway",
                "uptime_seconds":      int(time.Since(s.started).Seconds()),
                "series_active":       s.series.SeriesCount(),
                "metrics_ingested":    s.series.IngestTotal(),
                "logs_ingested":       s.logs.IngestTotal(),
                "agents_connected":    s.agents.LiveCount(12 * time.Second),
                "goroutines":          runtime.NumGoroutine(),
                "heap_mb":             float64(ms.HeapAlloc) / (1 << 20),
                "requests_per_second": round2(s.rps.Load()),
        })
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
        writeJSON(w, http.StatusOK, map[string]any{
                "status":  "ok",
                "service": "ingest-gateway",
                "time":    time.Now().UTC().Format(time.RFC3339),
        })
}

func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }

// ---- SSE stream -------------------------------------------------------------

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
        flusher, ok := w.(http.Flusher)
        if !ok {
                writeErr(w, http.StatusInternalServerError, "streaming unsupported")
                return
        }
        w.Header().Set("content-type", "text/event-stream")
        w.Header().Set("cache-control", "no-cache")
        w.Header().Set("connection", "keep-alive")

        ch := make(chan model.LogEntry, 64)
        s.subMu.Lock()
        s.subs[ch] = struct{}{}
        s.subMu.Unlock()
        defer func() {
                s.subMu.Lock()
                delete(s.subs, ch)
                s.subMu.Unlock()
        }()

        // Prime the stream so clients render immediately.
        s.writeHeartbeat(w, flusher)

        ctx := r.Context()
        tick := time.NewTicker(2 * time.Second)
        defer tick.Stop()
        for {
                select {
                case <-ctx.Done():
                        return
                case e := <-ch:
                        b, _ := json.Marshal(map[string]any{"type": "log", "data": e})
                        _, _ = w.Write([]byte("event: log\ndata: " + string(b) + "\n\n"))
                        flusher.Flush()
                case <-tick.C:
                        s.writeHeartbeat(w, flusher)
                }
        }
}

func (s *Server) writeHeartbeat(w http.ResponseWriter, flusher http.Flusher) {
        b, _ := json.Marshal(map[string]any{
                "type": "heartbeat",
                "ts":   time.Now().UnixMilli(),
                "stats": map[string]any{
                        "series_active": s.series.SeriesCount(),
                        "agents":        s.agents.LiveCount(12 * time.Second),
                        "rps":           round2(s.rps.Load()),
                },
        })
        _, _ = w.Write([]byte("event: heartbeat\ndata: " + string(b) + "\n\n"))
        flusher.Flush()
}

// FanoutLogs distributes accepted log entries to all SSE subscribers.
// Slow subscribers drop events instead of blocking ingest.
func (s *Server) FanoutLogs(logCh <-chan model.LogEntry) {
        for e := range logCh {
                s.subMu.Lock()
                for ch := range s.subs {
                        select {
                        case ch <- e:
                        default:
                        }
                }
                s.subMu.Unlock()
        }
}

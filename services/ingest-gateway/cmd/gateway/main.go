// Command gateway is the Lodestar telemetry ingestion entrypoint.
//
// Configuration (environment variables):
//
//	PORT           HTTP listen port            (default 3100)
//	API_KEYS       comma-separated API keys    (default pg_live_demo_key)
//	RING_SECONDS   per-series retention        (default 7200 => 2h)
//	LOG_CAPACITY   log ring capacity           (default 8000)
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"lodestar/ingest/internal/api"
	"lodestar/ingest/internal/auth"
	"lodestar/ingest/internal/collector"
	"lodestar/ingest/internal/gauge"
	"lodestar/ingest/internal/model"
	"lodestar/ingest/internal/store"
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	port := envOr("PORT", "3100")
	keys := envOr("API_KEYS", "pg_live_demo_key")
	ringSeconds, _ := strconv.Atoi(envOr("RING_SECONDS", "7200"))
	logCap, _ := strconv.Atoi(envOr("LOG_CAPACITY", "8000"))

	ss := store.NewSeriesStore(ringSeconds)
	ls := store.NewLogStore(logCap)
	at := store.NewAgentTracker()
	verifier := auth.New(keys)
	rps := &gauge.Gauge{}
	logCh := make(chan model.LogEntry, 256)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	col := collector.New(ss, ls, logCh, rps)
	go col.Run(ctx)

	srv := api.NewServer(ss, ls, at, verifier, logCh, rps)
	go srv.FanoutLogs(logCh)

	httpSrv := &http.Server{
		Addr:              ":" + port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      0, // SSE streams are long-lived
		IdleTimeout:       90 * time.Second,
	}

	go func() {
		mode := "authenticated"
		if !verifier.Enabled() {
			mode = "open-dev"
		}
		slog.Info("ingest-gateway listening", "port", port, "auth", mode)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http server failed", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down ingest-gateway")
	shCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shCtx)
}

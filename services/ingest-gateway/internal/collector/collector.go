// Package collector synthesises realistic service telemetry so that the
// platform has a live signal stream even before real agents check in.
//
// It is deliberately deterministic in shape: a diurnal sine baseline, a
// bounded random walk for texture, and scheduled anomaly windows so the
// AIOps engine always has meaningful signal to detect. In a production
// deployment this component is disabled and the gateway forwards purely
// agent traffic (see ARCHITECTURE.md, ADR-002).
package collector

import (
	"context"
	"log/slog"
	"math"
	"math/rand"
	"strconv"
	"time"

	"lodestar/ingest/internal/gauge"
	"lodestar/ingest/internal/model"
	"lodestar/ingest/internal/store"
)

// ServiceProfile describes one synthesised service.
type ServiceProfile struct {
	Name    string
	ReqRate float64 // baseline requests/sec
	ErrRate float64 // baseline error ratio (0..1)
	LatP50  float64 // baseline p50 ms
	Tier    string
}

// DefaultProfiles are the six reference services seeded by the web app.
func DefaultProfiles() []ServiceProfile {
	return []ServiceProfile{
		{Name: "api-gateway", ReqRate: 2400, ErrRate: 0.004, LatP50: 18, Tier: "edge"},
		{Name: "checkout-service", ReqRate: 640, ErrRate: 0.012, LatP50: 42, Tier: "critical"},
		{Name: "auth-service", ReqRate: 980, ErrRate: 0.003, LatP50: 24, Tier: "critical"},
		{Name: "search-cluster", ReqRate: 420, ErrRate: 0.008, LatP50: 88, Tier: "standard"},
		{Name: "billing-worker", ReqRate: 190, ErrRate: 0.006, LatP50: 65, Tier: "standard"},
		{Name: "edge-cdn", ReqRate: 5100, ErrRate: 0.002, LatP50: 9, Tier: "edge"},
	}
}

// Collector drives the synthesis loop.
type Collector struct {
	store    *store.SeriesStore
	logs     *store.LogStore
	profiles []ServiceProfile
	rng      *rand.Rand
	rps      *gauge.Gauge // shared traffic gauge consumed by /v1/stats
	// random-walk state per service
	walk        map[string]float64
	anomalySvc  string
	anomalyEnd  time.Time
	nextAnomaly time.Time
	logSvc      *hub
}

// hub is a minimal publish channel shared with the SSE endpoint.
type hub struct{ ch chan model.LogEntry }

func (h *hub) publish(e model.LogEntry) {
	select {
	case h.ch <- e:
	default: // subscriber too slow; drop rather than block ingest
	}
}

// New creates a collector writing into the given stores. The rps gauge is
// updated every tick with the estimated requests-per-second across services.
func New(ss *store.SeriesStore, ls *store.LogStore, logs chan model.LogEntry, rps *gauge.Gauge) *Collector {
	return &Collector{
		store: ss, logs: ls,
		profiles: DefaultProfiles(),
		rng:      rand.New(rand.NewSource(42)), // #nosec G404 -- telemetry shaping, not security
		rps:      rps,
		walk:     make(map[string]float64),
		logSvc:   &hub{ch: logs},
	}
}

// Run blocks until ctx is cancelled, emitting one tick per second.
func (c *Collector) Run(ctx context.Context) {
	c.nextAnomaly = time.Now().Add(45 * time.Second)
	t := time.NewTicker(time.Second)
	defer t.Stop()
	now := time.Now()
	// Pre-seed ~15 minutes of history so dashboards are never empty on boot.
	for i := 900; i > 0; i-- {
		c.tick(now.Add(-time.Duration(i)*time.Second), false)
	}
	slog.Info("collector: pre-seeded 15m of telemetry", "services", len(c.profiles))
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			c.tick(now, true)
		}
	}
}

func (c *Collector) tick(now time.Time, live bool) {
	// Schedule anomaly windows roughly every 60-140s.
	if live && c.anomalySvc == "" && now.After(c.nextAnomaly) {
		p := c.profiles[c.rng.Intn(len(c.profiles))]
		c.anomalySvc = p.Name
		c.anomalyEnd = now.Add(time.Duration(18+c.rng.Intn(22)) * time.Second)
		c.nextAnomaly = now.Add(time.Duration(60+c.rng.Intn(80)) * time.Second)
	}
	inAnomaly := c.anomalySvc != "" && now.Before(c.anomalyEnd)
	if live && c.anomalySvc != "" && !inAnomaly {
		c.emitLog(now, c.anomalySvc, "warn", "recovered: metrics returned within expected envelope")
		c.anomalySvc = ""
	}

	minute := float64(now.Minute())/60 + float64(now.Second())/3600
	diurnal := 0.5 + 0.5*math.Sin(2*math.Pi*(float64(now.Hour())+minute)/24-1.2)

	totalRps := 0.0
	for _, p := range c.profiles {
		key := p.Name
		c.walk[key] = clamp(c.walk[key]*0.98+c.rng.NormFloat64()*0.6, -30, 30)
		w := c.walk[key]
		spike := 1.0
		errAdd := 0.0
		if p.Name == c.anomalySvc {
			spike = 1.9 + c.rng.Float64()*0.9
			errAdd = 0.05 + c.rng.Float64()*0.08
		}
		load := 0.75 + 0.45*diurnal

		reqRate := p.ReqRate * load * (1 + w/100) * spike
		totalRps += reqRate
		errRate := p.ErrRate + errAdd + math.Abs(w)/1000
		lat50 := p.LatP50 * (1 + math.Abs(w)/220) * (1 + (spike-1)*0.35)
		lat95 := lat50 * 2.6
		lat99 := lat50 * 3.8

		c.emit(now, "request.rate", reqRate, model.Tag{"service": p.Name, "tier": p.Tier, "source": "simulated"})
		c.emit(now, "error.rate", errRate*100, model.Tag{"service": p.Name, "source": "simulated"})
		c.emit(now, "latency.p50", lat50, model.Tag{"service": p.Name, "source": "simulated"})
		c.emit(now, "latency.p95", lat95, model.Tag{"service": p.Name, "source": "simulated"})
		c.emit(now, "latency.p99", lat99, model.Tag{"service": p.Name, "source": "simulated"})
	}
	c.rps.Store(totalRps)

	// Host-shaped fallback series; the C edge agent supersedes these with
	// real /proc samples tagged source=agent.
	c.emit(now, "cpu.usage", 28+22*diurnal+c.rng.Float64()*6, model.Tag{"host": "sandbox", "source": "simulated"})
	c.emit(now, "mem.used", 46+14*diurnal+c.rng.Float64()*4, model.Tag{"host": "sandbox", "source": "simulated"})

	if live {
		if c.rng.Float64() < 0.30 {
			c.emitServiceLog(now)
		}
		if c.anomalySvc != "" && c.rng.Float64() < 0.5 {
			c.emitLog(now, c.anomalySvc, "error", anomalyMessage(c.anomalySvc, c.rng))
		}
	}
}

func (c *Collector) emit(now time.Time, name string, v float64, tags model.Tag) {
	c.store.Add(model.Metric{Name: name, Value: round2(v), Tags: tags, TS: now.UnixMilli()})
}

func (c *Collector) emitLog(now time.Time, svc, level, msg string) {
	e := model.LogEntry{Level: level, Service: svc, Message: msg, TS: now.UnixMilli()}
	c.logs.Add(e)
	c.logSvc.publish(e)
}

func (c *Collector) emitServiceLog(now time.Time) {
	p := c.profiles[c.rng.Intn(len(c.profiles))]
	var level, msg string
	switch c.rng.Intn(8) {
	case 0:
		level, msg = "info", "request batch processed in "+strconv.Itoa(3+c.rng.Intn(40))+"ms"
	case 1:
		level, msg = "info", "connection pool resized to "+strconv.Itoa(24+c.rng.Intn(48))+" conns"
	case 2:
		level, msg = "debug", "cache hit ratio "+strconv.FormatFloat(0.8+c.rng.Float64()*0.15, 'f', 3, 64)
	case 3:
		level, msg = "warn", "slow query detected: "+strconv.Itoa(120+c.rng.Intn(400))+"ms"
	case 4:
		level, msg = "info", "deployment v"+strconv.Itoa(c.rng.Intn(9))+"."+strconv.Itoa(c.rng.Intn(40))+" health check passed"
	case 5:
		level, msg = "warn", "retrying upstream call (attempt "+strconv.Itoa(1+c.rng.Intn(3))+")"
	case 6:
		level, msg = "info", "autoscaler kept desired capacity at "+strconv.Itoa(2+c.rng.Intn(6))+" replicas"
	default:
		level, msg = "info", "gc pause "+strconv.Itoa(2+c.rng.Intn(18))+"ms, heap ok"
	}
	c.emitLog(now, p.Name, level, msg)
}

func anomalyMessage(svc string, r *rand.Rand) string {
	switch r.Intn(4) {
	case 0:
		return "upstream latency budget exceeded on " + svc + " - failing fast"
	case 1:
		return "connection pool exhausted, queuing requests"
	case 2:
		return "5xx rate above threshold: circuit breaker half-open"
	default:
		return "dependency timeout storm detected, shedding load"
	}
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

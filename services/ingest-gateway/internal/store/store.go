// Package store provides the in-memory ring buffers used by the gateway.
// The design favours predictable latency and O(1) memory over durability:
// hot telemetry lives in bounded rings, and persistence is delegated to
// downstream storage in a full deployment (see ARCHITECTURE.md, ADR-002).
package store

import (
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"lodestar/ingest/internal/model"
)

// Ring is a fixed-capacity ring buffer of time-ordered points.
type Ring struct {
	mu   sync.RWMutex
	pts  []model.Point
	cap  int
	head int // index of oldest element when full
	full bool
}

// NewRing creates a ring holding up to capacity points.
func NewRing(capacity int) *Ring {
	if capacity < 8 {
		capacity = 8
	}
	return &Ring{pts: make([]model.Point, 0, capacity), cap: capacity}
}

// Add appends a point, evicting the oldest when full.
func (r *Ring) Add(p model.Point) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.pts) < r.cap {
		r.pts = append(r.pts, p)
		return
	}
	if r.head == len(r.pts) {
		r.head = 0
	}
	r.pts[r.head] = p
	r.head++
	r.full = true
}

// Snapshot returns points in chronological order.
func (r *Ring) Snapshot() []model.Point {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.full {
		out := make([]model.Point, len(r.pts))
		copy(out, r.pts)
		return out
	}
	out := make([]model.Point, 0, len(r.pts))
	out = append(out, r.pts[r.head:]...)
	out = append(out, r.pts[:r.head]...)
	return out
}

// Downsample returns up to n points, bucket-averaged, newest bucket aligned
// to the most recent sample. Used by the query API to keep payloads small.
func (r *Ring) Downsample(n int) []model.Point {
	all := r.Snapshot()
	if n <= 0 || len(all) <= n {
		return all
	}
	bucket := len(all) / n
	if bucket < 1 {
		bucket = 1
	}
	out := make([]model.Point, 0, n+1)
	for i := 0; i < len(all); i += bucket {
		end := i + bucket
		if end > len(all) {
			end = len(all)
		}
		var sum float64
		for _, p := range all[i:end] {
			sum += p.Value
		}
		out = append(out, model.Point{TS: all[end-1].TS, Value: sum / float64(end-i)})
	}
	return out
}

// Len reports the current point count.
func (r *Ring) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.pts)
}

type seriesMeta struct {
	name string
	tags model.Tag
	key  string
	ring *Ring
}

// SeriesStore keeps every distinct (name, tags) combination in its own ring.
type SeriesStore struct {
	mu      sync.RWMutex
	series  map[string]*seriesMeta
	ringCap int
	ingest  atomic.Int64
}

// NewSeriesStore creates a store with per-series ring capacity.
func NewSeriesStore(ringCapacity int) *SeriesStore {
	return &SeriesStore{series: make(map[string]*seriesMeta), ringCap: ringCapacity}
}

// SeriesKey builds the canonical key for a name/tag combination.
func SeriesKey(name string, tags model.Tag) string {
	keys := make([]string, 0, len(tags))
	for k := range tags {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString(name)
	for _, k := range keys {
		b.WriteByte('\x1f')
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(tags[k])
	}
	return b.String()
}

// Add records a metric sample.
func (s *SeriesStore) Add(m model.Metric) {
	key := SeriesKey(m.Name, m.Tags)
	s.mu.Lock()
	sm, ok := s.series[key]
	if !ok {
		sm = &seriesMeta{name: m.Name, tags: m.Tags, key: key, ring: NewRing(s.ringCap)}
		s.series[key] = sm
	}
	s.mu.Unlock()
	sm.ring.Add(model.Point{TS: m.TS, Value: m.Value})
	s.ingest.Add(1)
}

// Query returns downsampled series for the requested names, optionally
// filtered by tag equality (service, source). Unknown names yield empty
// series so callers can distinguish "no data" from "bad request".
func (s *SeriesStore) Query(names []string, filters model.Tag, from int64, points int) []model.Series {
	want := make(map[string]bool, len(names))
	for _, n := range names {
		want[n] = true
	}
	out := make([]model.Series, 0, len(names))
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sm := range s.series {
		if len(want) > 0 && !want[sm.name] {
			continue
		}
		if !tagsMatch(sm.tags, filters) {
			continue
		}
		pts := sm.ring.Snapshot()
		// Trim to the requested window.
		lo := 0
		for lo < len(pts) && pts[lo].TS < from {
			lo++
		}
		pts = pts[lo:]
		if len(pts) == 0 {
			continue
		}
		if points > 0 && len(pts) > points {
			pts = ringDownsample(pts, points)
		}
		out = append(out, model.Series{Name: sm.name, Tags: sm.tags, Points: pts})
	}
	sort.Slice(out, func(i, j int) bool { return seriesSortKey(out[i]) < seriesSortKey(out[j]) })
	return out
}

// SeriesCount reports the number of distinct active series.
func (s *SeriesStore) SeriesCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.series)
}

// IngestTotal reports the cumulative number of accepted metric samples.
func (s *SeriesStore) IngestTotal() int64 { return s.ingest.Load() }

func tagsMatch(tags, filters model.Tag) bool {
	for k, v := range filters {
		if tags[k] != v {
			return false
		}
	}
	return true
}

func seriesSortKey(s model.Series) string {
	return s.Name + "\x1f" + s.Tags["service"] + "\x1f" + s.Tags["source"]
}

// ringDownsample mirrors Ring.Downsample for a plain slice.
func ringDownsample(all []model.Point, n int) []model.Point {
	if n <= 0 || len(all) <= n {
		return all
	}
	bucket := len(all) / n
	if bucket < 1 {
		bucket = 1
	}
	out := make([]model.Point, 0, n+1)
	for i := 0; i < len(all); i += bucket {
		end := i + bucket
		if end > len(all) {
			end = len(all)
		}
		var sum float64
		for _, p := range all[i:end] {
			sum += p.Value
		}
		out = append(out, model.Point{TS: all[end-1].TS, Value: sum / float64(end-i)})
	}
	return out
}

// LogStore is a bounded newest-first log buffer.
type LogStore struct {
	mu     sync.RWMutex
	logs   []model.LogEntry // newest last, ring semantics via head
	cap    int
	head   int
	full   bool
	ingest atomic.Int64
}

// NewLogStore creates a log buffer of capacity entries.
func NewLogStore(capacity int) *LogStore {
	return &LogStore{logs: make([]model.LogEntry, 0, capacity), cap: capacity}
}

// Add appends a log entry.
func (l *LogStore) Add(e model.LogEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.logs) < l.cap {
		l.logs = append(l.logs, e)
		return
	}
	if l.head == len(l.logs) {
		l.head = 0
	}
	l.logs[l.head] = e
	l.head++
	l.full = true
	l.ingest.Add(1)
}

// Query returns up to limit entries, newest first, applying level/service/text
// filters. It also reports the total number of stored entries.
func (l *LogStore) Query(limit int, level, service, q string) ([]model.LogEntry, int) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	q = strings.ToLower(q)
	out := make([]model.LogEntry, 0, limit)
	for i := len(l.logs) - 1; i >= 0 && len(out) < limit; i-- {
		e := l.logs[i]
		if level != "" && e.Level != level {
			continue
		}
		if service != "" && e.Service != service {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(e.Message), q) {
			continue
		}
		out = append(out, e)
	}
	return out, len(l.logs)
}

// IngestTotal reports cumulative accepted log entries.
func (l *LogStore) IngestTotal() int64 { return l.ingest.Load() }

// AgentTracker records ingest sources and reports how many are live.
type AgentTracker struct {
	mu    sync.Mutex
	hosts map[string]int64 // host -> last seen unix ms
}

// NewAgentTracker creates an empty tracker.
func NewAgentTracker() *AgentTracker { return &AgentTracker{hosts: make(map[string]int64)} }

// Touch records activity from a host.
func (a *AgentTracker) Touch(host string) {
	if host == "" {
		return
	}
	a.mu.Lock()
	a.hosts[host] = time.Now().UnixMilli()
	a.mu.Unlock()
}

// LiveCount reports hosts seen within the last ttl.
func (a *AgentTracker) LiveCount(ttl time.Duration) int {
	cutoff := time.Now().Add(-ttl).UnixMilli()
	a.mu.Lock()
	defer a.mu.Unlock()
	n := 0
	for _, last := range a.hosts {
		if last >= cutoff {
			n++
		}
	}
	return n
}

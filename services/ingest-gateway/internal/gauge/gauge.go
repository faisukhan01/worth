// Package gauge provides a concurrency-safe float64 gauge. It avoids
// atomic.Float64 for portability across stripped-down Go toolchains by
// storing the value as atomic bit patterns (see ADR-002).
package gauge

import (
	"math"
	"sync/atomic"
)

// Gauge is a single-writer, many-reader float64 metric.
type Gauge struct {
	bits atomic.Uint64
}

// Store atomically sets the gauge value.
func (g *Gauge) Store(v float64) { g.bits.Store(math.Float64bits(v)) }

// Load atomically returns the gauge value.
func (g *Gauge) Load() float64 { return math.Float64frombits(g.bits.Load()) }

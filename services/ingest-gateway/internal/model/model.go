// Package model defines the wire and storage types shared across the
// Lodestar ingest gateway. Timestamps are epoch milliseconds (UTC) end to end.
package model

// Tag is a free-form label set attached to a metric series.
type Tag map[string]string

// Metric is a single time-series sample accepted by the ingest API.
type Metric struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Tags  Tag     `json:"tags,omitempty"`
	TS    int64   `json:"ts"` // epoch ms
}

// LogEntry is a structured log line accepted by the ingest API.
type LogEntry struct {
	Level   string `json:"level"`
	Service string `json:"service"`
	Message string `json:"message"`
	TS      int64  `json:"ts"` // epoch ms
}

// Point is a downsampled series datapoint returned by the query API.
type Point struct {
	TS    int64   `json:"ts"`
	Value float64 `json:"value"`
}

// Series is a named, tagged sequence of points.
type Series struct {
	Name   string  `json:"name"`
	Tags   Tag     `json:"tags,omitempty"`
	Points []Point `json:"points"`
}

// MetricsBatch is the ingest payload for metrics.
type MetricsBatch struct {
	Metrics []Metric `json:"metrics"`
}

// LogsBatch is the ingest payload for logs.
type LogsBatch struct {
	Logs []LogEntry `json:"logs"`
}

// IngestResult reports accepted/rejected counts for a batch.
type IngestResult struct {
	Accepted int `json:"accepted"`
	Rejected int `json:"rejected"`
}

// Levels is the set of accepted log levels.
var Levels = map[string]bool{
	"trace": true, "debug": true, "info": true,
	"warn": true, "error": true, "fatal": true,
}

// Package auth implements API-key middleware for the ingest gateway.
// Keys are provisioned out of band and compared in constant time.
package auth

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// Verifier checks request keys against the configured allow-list.
type Verifier struct {
	keys []string
}

// New builds a verifier from a comma-separated key list.
func New(commaKeys string) *Verifier {
	parts := strings.Split(commaKeys, ",")
	keys := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			keys = append(keys, p)
		}
	}
	return &Verifier{keys: keys}
}

// Enabled reports whether any key is configured.
func (v *Verifier) Enabled() bool { return v != nil && len(v.keys) > 0 }

// Check reports whether the supplied raw key is valid.
func (v *Verifier) Check(raw string) bool {
	if !v.Enabled() {
		return true
	}
	for _, k := range v.keys {
		if len(k) == len(raw) && subtle.ConstantTimeCompare([]byte(k), []byte(raw)) == 1 {
			return true
		}
	}
	return false
}

// Middleware rejects requests without a valid x-api-key header.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !v.Check(r.Header.Get("x-api-key")) {
			w.Header().Set("content-type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid or missing api key"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

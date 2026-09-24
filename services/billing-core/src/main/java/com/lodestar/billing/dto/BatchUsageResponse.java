package com.lodestar.billing.dto;

import java.util.List;

/**
 * Result of {@code POST /v1/usage/batch}. Batches are processed atomically per event: accepted
 * events are persisted even when siblings are rejected, and the {@code errors} list documents
 * every duplicate and rejection for producer-side auditing ({@code duplicates + rejected} equals
 * {@code errors.size()}).
 *
 * @param received  total events in the submitted batch
 * @param accepted  events persisted to the usage ledger
 * @param duplicates events acknowledged as already ingested (idempotent replays)
 * @param rejected  events refused by validation or quota enforcement
 * @param errors    per-event detail for duplicates and rejections
 */
public record BatchUsageResponse(int received, int accepted, int duplicates, int rejected,
                                 List<RejectedEvent> errors) {
}

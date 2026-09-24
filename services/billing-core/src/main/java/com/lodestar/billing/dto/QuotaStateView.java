package com.lodestar.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * API projection of a configured quota.
 *
 * @param orgId               billing organisation identifier
 * @param metricName          billing metric name
 * @param softLimit           consumption level that starts emitting warnings, or {@code null}
 * @param hardLimit           consumption level that blocks ingestion, or {@code null}
 * @param consumedThisPeriod  fast-path consumption counter for the open billing period
 * @param periodStart         start of the billing period the counter is aligned to
 * @param lastEnforcedAt      last time the quota engine evaluated this row
 */
public record QuotaStateView(String orgId, String metricName, BigDecimal softLimit, BigDecimal hardLimit,
                             BigDecimal consumedThisPeriod, Instant periodStart, Instant lastEnforcedAt) {
}

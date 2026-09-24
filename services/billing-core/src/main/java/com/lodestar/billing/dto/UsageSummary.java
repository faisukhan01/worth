package com.lodestar.billing.dto;

import java.time.Instant;
import java.util.List;

/**
 * Usage report for an organisation over a window: per-metric totals plus a bucketed time series.
 *
 * @param orgId       billing organisation identifier
 * @param plan        plan the organisation is currently subscribed to
 * @param periodStart inclusive start of the reported window
 * @param periodEnd   exclusive end of the reported window
 * @param totals      summed consumption per metric over the window
 * @param series      bucketed consumption time series (hourly or daily)
 */
public record UsageSummary(String orgId, String plan, Instant periodStart, Instant periodEnd,
                           List<MetricTotal> totals, List<UsagePoint> series) {
}

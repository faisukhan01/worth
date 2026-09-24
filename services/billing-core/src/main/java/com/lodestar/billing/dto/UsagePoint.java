package com.lodestar.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One bucket of a usage time series.
 *
 * @param metricName  billing metric name
 * @param bucketStart UTC start of the bucket (truncated to hour or day)
 * @param total       summed quantity within the bucket
 */
public record UsagePoint(String metricName, Instant bucketStart, BigDecimal total) {
}

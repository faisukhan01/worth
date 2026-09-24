package com.lodestar.billing.dto;

import java.math.BigDecimal;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * Admin request to create or override the limits of one {@code (org, metric)} quota. Both limits
 * are optional: omitted fields keep their current value (or the plan-derived default when the
 * quota does not exist yet). The soft limit must not exceed the hard limit.
 *
 * @param orgId      billing organisation identifier
 * @param metricName billing metric name
 * @param softLimit  new soft limit, or {@code null} to keep the current one
 * @param hardLimit  new hard limit, or {@code null} to keep the current one
 */
public record QuotaUpsertRequest(
        @NotBlank(message = "orgId is required") String orgId,
        @NotBlank(message = "metricName is required") String metricName,
        @PositiveOrZero(message = "softLimit must be zero or positive") BigDecimal softLimit,
        @Positive(message = "hardLimit must be positive") BigDecimal hardLimit) {
}

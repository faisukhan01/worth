package com.lodestar.billing.dto;

import java.math.BigDecimal;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/**
 * Request body of {@code POST /v1/quotas/check}: "may I consume this much more?"
 *
 * @param orgId      billing organisation identifier
 * @param metricName billing metric name
 * @param additional quantity the caller intends to consume next
 */
public record QuotaCheckRequest(
        @NotBlank(message = "orgId is required") String orgId,
        @NotBlank(message = "metricName is required") String metricName,
        @NotNull(message = "additional is required")
        @Positive(message = "additional must be positive") BigDecimal additional) {
}

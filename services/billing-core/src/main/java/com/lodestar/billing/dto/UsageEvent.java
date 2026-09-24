package com.lodestar.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/**
 * A single metered usage event submitted to the ingestion API.
 *
 * <p>{@code externalId} is the producer's idempotency key: re-submitting an event with the same
 * id is acknowledged but never billed twice.
 *
 * @param externalId producer-supplied unique id of this event (idempotency key)
 * @param orgId      billing organisation identifier
 * @param serviceId  customer service that produced the usage
 * @param metricName billing metric name, e.g. {@code ingested.events}
 * @param unit       measurement unit; when blank, the canonical unit of the metric is applied
 * @param quantity   consumed quantity; must be positive
 * @param recordedAt UTC instant at which the usage occurred
 */
public record UsageEvent(
        @NotBlank(message = "externalId is required for idempotent ingestion") String externalId,
        @NotBlank(message = "orgId is required") String orgId,
        @NotBlank(message = "serviceId is required") String serviceId,
        @NotBlank(message = "metricName is required") String metricName,
        String unit,
        @NotNull(message = "quantity is required")
        @Positive(message = "quantity must be positive") BigDecimal quantity,
        @NotNull(message = "recordedAt is required") Instant recordedAt) {
}

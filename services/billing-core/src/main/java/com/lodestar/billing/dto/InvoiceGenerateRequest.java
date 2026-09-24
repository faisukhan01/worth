package com.lodestar.billing.dto;

import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Request body of {@code POST /v1/invoices/generate}.
 *
 * @param orgId       billing organisation identifier
 * @param periodStart inclusive start of the billed period (UTC)
 * @param periodEnd   exclusive end of the billed period (UTC)
 */
public record InvoiceGenerateRequest(
        @NotBlank(message = "orgId is required") String orgId,
        @NotNull(message = "periodStart is required") Instant periodStart,
        @NotNull(message = "periodEnd is required") Instant periodEnd) {
}

package com.lodestar.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * API projection of an invoice, including its rendered line items.
 *
 * @param id          invoice identifier
 * @param orgId       billing organisation identifier
 * @param periodStart inclusive start of the billed period
 * @param periodEnd   exclusive end of the billed period
 * @param currency    ISO 4217 currency code (currently {@code USD})
 * @param status      lifecycle state: {@code DRAFT}, {@code ISSUED} or {@code PAID}
 * @param subtotal    recurring charges (base plan plus additional seats)
 * @param overage     metered usage charges above the included allowances
 * @param total       amount due, i.e. {@code subtotal + overage}
 * @param issuedAt    when the invoice left draft state, or {@code null} while a draft
 * @param createdAt   when the invoice was first generated
 * @param lineItems   rendered line items
 */
public record InvoiceView(UUID id, String orgId, Instant periodStart, Instant periodEnd, String currency,
                          String status, BigDecimal subtotal, BigDecimal overage, BigDecimal total,
                          Instant issuedAt, Instant createdAt, List<LineItemView> lineItems) {
}

package com.lodestar.billing.dto;

import java.math.BigDecimal;

/**
 * API projection of an invoice line item. Kept as a distinct type from the persisted
 * {@link LineItem} so the storage document and the public API contract can evolve
 * independently.
 *
 * @param kind        classification of the charge
 * @param description human-readable rendering of the charge
 * @param quantity    billable quantity
 * @param unitPrice   price per unit in the invoice currency
 * @param amount      line total
 */
public record LineItemView(LineItemKind kind, String description, BigDecimal quantity,
                           BigDecimal unitPrice, BigDecimal amount) {
}

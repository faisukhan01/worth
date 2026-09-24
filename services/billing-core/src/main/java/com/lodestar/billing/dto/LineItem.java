package com.lodestar.billing.dto;

import java.math.BigDecimal;

/**
 * A rendered invoice line item. This is the <em>persistence</em> shape: instances are serialized
 * as the {@code line_items_json} document stored on an invoice, so the storage schema can evolve
 * independently of the API contract (exposed via {@link LineItemView}).
 *
 * @param kind       classification of the charge
 * @param description human-readable rendering used on the customer-facing document
 * @param quantity   billable quantity (e.g. seats, or millions of events above the allowance)
 * @param unitPrice  price per unit in the invoice currency
 * @param amount     line total, i.e. {@code quantity * unitPrice} rounded to currency scale
 */
public record LineItem(LineItemKind kind, String description, BigDecimal quantity,
                       BigDecimal unitPrice, BigDecimal amount) {
}

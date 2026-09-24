package com.lodestar.billing.domain;

/**
 * Lifecycle state of an invoice.
 */
public enum InvoiceStatus {

    /** Being assembled; line items may still change. Draft invoices are regenerated on demand. */
    DRAFT,

    /** Issued to the customer; the invoice is immutable and a payment is expected. */
    ISSUED,

    /** Payment has been received and reconciled. */
    PAID
}

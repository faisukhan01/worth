package com.lodestar.billing.dto;

/**
 * Classification of an invoice line item.
 */
public enum LineItemKind {

    /** The prorated base price of the subscribed plan. */
    BASE_PLAN,

    /** Seats beyond the plan's included seat allowance. */
    ADDITIONAL_SEATS,

    /** Metered usage above the plan's included allowances. */
    USAGE_OVERAGE
}

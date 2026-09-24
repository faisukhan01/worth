package com.lodestar.billing.domain;

/**
 * Lifecycle state of a Lodestar subscription.
 */
public enum SubscriptionStatus {

    /** Subscription is active and billing normally. */
    ACTIVE,

    /** Payment is overdue; usage continues to meter but collection is escalated. */
    PAST_DUE,

    /** Subscription has been cancelled; no further billing periods are opened. */
    CANCELED
}

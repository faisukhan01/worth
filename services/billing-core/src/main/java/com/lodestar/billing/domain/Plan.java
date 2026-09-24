package com.lodestar.billing.domain;

import java.math.BigDecimal;

/**
 * Commercial plans offered by Lodestar.
 *
 * <p>Each plan bundles a flat monthly base price with free allowances (metered events and
 * monitored hosts) plus a per-unit overage price for ingestion beyond the allowance. The catalog
 * is intentionally code-defined: it is small, changes rarely, and benefits from compile-time
 * safety. A database-backed catalog can later be introduced behind
 * {@code com.lodestar.billing.service.PricingService} without touching any caller.
 */
public enum Plan {

    /** Entry tier for small teams. */
    STARTER(new BigDecimal("29.00"), 5_000_000L, 3, new BigDecimal("0.80")),

    /** Growth tier - the default for production workloads. */
    PRO(new BigDecimal("199.00"), 50_000_000L, 15, new BigDecimal("0.50")),

    /** Enterprise tier with large included allowances. */
    ENTERPRISE(new BigDecimal("1999.00"), 500_000_000L, 100, new BigDecimal("0.35"));

    private final BigDecimal monthlyBasePrice;
    private final long includedEventsPerMonth;
    private final int includedHosts;
    private final BigDecimal perMillionOverage;

    Plan(BigDecimal monthlyBasePrice, long includedEventsPerMonth, int includedHosts, BigDecimal perMillionOverage) {
        this.monthlyBasePrice = monthlyBasePrice;
        this.includedEventsPerMonth = includedEventsPerMonth;
        this.includedHosts = includedHosts;
        this.perMillionOverage = perMillionOverage;
    }

    /** @return flat monthly base price in USD before any usage overage. */
    public BigDecimal getMonthlyBasePrice() {
        return monthlyBasePrice;
    }

    /** @return number of ingested events per month included in the base price. */
    public long getIncludedEventsPerMonth() {
        return includedEventsPerMonth;
    }

    /** @return number of monitored hosts included in the base price. */
    public int getIncludedHosts() {
        return includedHosts;
    }

    /** @return price in USD per one million ingested events above the included allowance. */
    public BigDecimal getPerMillionOverage() {
        return perMillionOverage;
    }
}

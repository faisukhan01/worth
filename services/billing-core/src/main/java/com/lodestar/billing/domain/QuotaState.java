package com.lodestar.billing.domain;

import java.math.BigDecimal;
import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * Quota enforcement state for one {@code (organisation, metric)} pair.
 *
 * <p>Quotas are two-tiered: a <em>soft limit</em> triggers a warning (by default at 80% of the
 * hard limit) while a <em>hard limit</em> blocks further ingestion of that metric. A {@code null}
 * limit means "not configured", i.e. unlimited on that tier.
 *
 * <p>{@code consumedThisPeriod} is a fast-path counter maintained by the quota service; it is
 * re-synchronised from the durable usage ledger whenever the billing period rolls over, so a
 * drifted counter can never permanently corrupt enforcement.
 */
@Entity
@Table(name = "quota_states")
public class QuotaState {

    @EmbeddedId
    private QuotaKey key;

    @Column(name = "soft_limit", precision = 20, scale = 6)
    private BigDecimal softLimit;

    @Column(name = "hard_limit", precision = 20, scale = 6)
    private BigDecimal hardLimit;

    @Column(name = "consumed_this_period", nullable = false, precision = 20, scale = 6)
    private BigDecimal consumedThisPeriod;

    @Column(name = "period_start")
    private Instant periodStart;

    @Column(name = "last_enforced_at")
    private Instant lastEnforcedAt;

    public QuotaState() {
        // Required by JPA; use the quota service to construct rows.
    }

    /** @return the composite {@code (orgId, metricName)} key. */
    public QuotaKey getKey() {
        return key;
    }

    public void setKey(QuotaKey key) {
        this.key = key;
    }

    /** @return consumption level that starts emitting warnings, or {@code null} for unlimited. */
    public BigDecimal getSoftLimit() {
        return softLimit;
    }

    public void setSoftLimit(BigDecimal softLimit) {
        this.softLimit = softLimit;
    }

    /** @return consumption level that blocks ingestion, or {@code null} for unlimited. */
    public BigDecimal getHardLimit() {
        return hardLimit;
    }

    public void setHardLimit(BigDecimal hardLimit) {
        this.hardLimit = hardLimit;
    }

    /** @return fast-path consumption counter for the current billing period. */
    public BigDecimal getConsumedThisPeriod() {
        return consumedThisPeriod;
    }

    public void setConsumedThisPeriod(BigDecimal consumedThisPeriod) {
        this.consumedThisPeriod = consumedThisPeriod;
    }

    /** @return start of the billing period the counter was last aligned to. */
    public Instant getPeriodStart() {
        return periodStart;
    }

    public void setPeriodStart(Instant periodStart) {
        this.periodStart = periodStart;
    }

    /** @return last time the quota engine evaluated this row. */
    public Instant getLastEnforcedAt() {
        return lastEnforcedAt;
    }

    public void setLastEnforcedAt(Instant lastEnforcedAt) {
        this.lastEnforcedAt = lastEnforcedAt;
    }
}

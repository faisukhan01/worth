package com.lodestar.billing.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A customer organisation's commercial agreement with Lodestar: the purchased {@link Plan}, the
 * licensed seat count, and the currently open billing period.
 *
 * <p>One subscription per organisation is enforced by a unique constraint on {@code org_id}; the
 * period bounds are UTC instants so invoicing is deterministic regardless of server timezone.
 */
@Entity
@Table(name = "subscriptions")
public class Subscription {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false, unique = true, length = 64)
    private String orgId;

    @Enumerated(EnumType.STRING)
    @Column(name = "plan", nullable = false, length = 16)
    private Plan plan;

    @Column(name = "current_period_start", nullable = false)
    private Instant currentPeriodStart;

    @Column(name = "current_period_end", nullable = false)
    private Instant currentPeriodEnd;

    @Column(name = "seats", nullable = false)
    private int seats;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private SubscriptionStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Subscription() {
        // Required by JPA; use setters to construct in application code.
    }

    /** @return stable surrogate identifier. */
    public UUID getId() {
        return id;
    }

    /** @return the billing organisation identifier, e.g. {@code org_demo}. */
    public String getOrgId() {
        return orgId;
    }

    public void setOrgId(String orgId) {
        this.orgId = orgId;
    }

    /** @return the plan this organisation is billed against. */
    public Plan getPlan() {
        return plan;
    }

    public void setPlan(Plan plan) {
        this.plan = plan;
    }

    /** @return inclusive start of the currently open billing period. */
    public Instant getCurrentPeriodStart() {
        return currentPeriodStart;
    }

    public void setCurrentPeriodStart(Instant currentPeriodStart) {
        this.currentPeriodStart = currentPeriodStart;
    }

    /** @return exclusive end of the currently open billing period. */
    public Instant getCurrentPeriodEnd() {
        return currentPeriodEnd;
    }

    public void setCurrentPeriodEnd(Instant currentPeriodEnd) {
        this.currentPeriodEnd = currentPeriodEnd;
    }

    /** @return number of licensed user seats; seats beyond the plan allowance are billed extra. */
    public int getSeats() {
        return seats;
    }

    public void setSeats(int seats) {
        this.seats = seats;
    }

    /** @return lifecycle state of the subscription. */
    public SubscriptionStatus getStatus() {
        return status;
    }

    public void setStatus(SubscriptionStatus status) {
        this.status = status;
    }

    /** @return when the subscription was first created. */
    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}

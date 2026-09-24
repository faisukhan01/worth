package com.lodestar.billing.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

/**
 * A single metered usage fact: how much of one billing metric one customer service consumed at a
 * point in time.
 *
 * <p>Usage records are append-only and form the durable source of truth that invoices and quota
 * counters are derived from. The composite index on {@code (org_id, metric_name, recorded_at)}
 * serves the dominant access pattern: aggregate quantity per metric over a billing window for a
 * given organisation.
 */
@Entity
@Table(name = "usage_records", indexes = {
        @Index(name = "idx_usage_org_metric_time", columnList = "org_id, metric_name, recorded_at")
})
public class UsageRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false, length = 64)
    private String orgId;

    @Column(name = "service_id", nullable = false, length = 64)
    private String serviceId;

    @Column(name = "metric_name", nullable = false, length = 64)
    private String metricName;

    @Column(name = "unit", nullable = false, length = 16)
    private String unit;

    @Column(name = "quantity", nullable = false, precision = 20, scale = 6)
    private BigDecimal quantity;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    public UsageRecord() {
        // Required by JPA; use setters to construct in application code.
    }

    /** @return stable surrogate identifier. */
    public UUID getId() {
        return id;
    }

    /** @return billing organisation the usage belongs to. */
    public String getOrgId() {
        return orgId;
    }

    public void setOrgId(String orgId) {
        this.orgId = orgId;
    }

    /** @return customer service that produced the usage (e.g. {@code api-gateway}). */
    public String getServiceId() {
        return serviceId;
    }

    public void setServiceId(String serviceId) {
        this.serviceId = serviceId;
    }

    /** @return billing metric name, e.g. {@code ingested.events}. */
    public String getMetricName() {
        return metricName;
    }

    public void setMetricName(String metricName) {
        this.metricName = metricName;
    }

    /** @return measurement unit, e.g. {@code events}, {@code GB} or {@code insights}. */
    public String getUnit() {
        return unit;
    }

    public void setUnit(String unit) {
        this.unit = unit;
    }

    /** @return consumed quantity in the metric's unit; always positive. */
    public BigDecimal getQuantity() {
        return quantity;
    }

    public void setQuantity(BigDecimal quantity) {
        this.quantity = quantity;
    }

    /** @return UTC instant at which the usage occurred. */
    public Instant getRecordedAt() {
        return recordedAt;
    }

    public void setRecordedAt(Instant recordedAt) {
        this.recordedAt = recordedAt;
    }
}

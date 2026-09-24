package com.lodestar.billing.domain;

import java.io.Serializable;
import java.util.Objects;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

/**
 * Composite natural key of a {@link QuotaState} row: one quota per organisation and billing
 * metric. Using the natural key as the primary key keeps quota lookups to a single indexed
 * read and makes the uniqueness invariant explicit in the schema.
 */
@Embeddable
public class QuotaKey implements Serializable {

    private static final long serialVersionUID = 1L;

    @Column(name = "org_id", nullable = false, length = 64)
    private String orgId;

    @Column(name = "metric_name", nullable = false, length = 64)
    private String metricName;

    protected QuotaKey() {
        // Required by JPA.
    }

    /**
     * @param orgId      billing organisation identifier
     * @param metricName billing metric name
     */
    public QuotaKey(String orgId, String metricName) {
        this.orgId = orgId;
        this.metricName = metricName;
    }

    /** @return billing organisation identifier. */
    public String getOrgId() {
        return orgId;
    }

    /** @return billing metric name. */
    public String getMetricName() {
        return metricName;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof QuotaKey other)) {
            return false;
        }
        return Objects.equals(orgId, other.orgId) && Objects.equals(metricName, other.metricName);
    }

    @Override
    public int hashCode() {
        return Objects.hash(orgId, metricName);
    }

    @Override
    public String toString() {
        return orgId + "/" + metricName;
    }
}

package com.lodestar.billing.domain;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Repository for {@link QuotaState} rows keyed by {@link QuotaKey}.
 */
public interface QuotaStateRepository extends JpaRepository<QuotaState, QuotaKey> {

    /**
     * Lists every configured quota of an organisation.
     *
     * @param orgId billing organisation identifier
     * @return quota states ordered by metric name
     */
    List<QuotaState> findByKeyOrgIdOrderByKeyMetricNameAsc(String orgId);
}

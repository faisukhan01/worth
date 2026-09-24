package com.lodestar.billing.domain;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Repository for {@link Subscription} aggregates.
 */
public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {

    /**
     * Looks up the subscription of an organisation.
     *
     * @param orgId billing organisation identifier
     * @return the subscription, or empty when the organisation is unknown to billing
     */
    Optional<Subscription> findByOrgId(String orgId);

    /**
     * Fast membership test used by the metering pipeline to reject events from unknown
     * organisations without loading the aggregate.
     *
     * @param orgId billing organisation identifier
     * @return {@code true} when a subscription exists for the organisation
     */
    boolean existsByOrgId(String orgId);
}

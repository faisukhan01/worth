package com.lodestar.billing.domain;

import java.time.Instant;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;

/**
 * Repository for the {@link ConsumedEvent} idempotency tombstones.
 */
public interface ConsumedEventRepository extends JpaRepository<ConsumedEvent, String> {

    /**
     * Bulk-deletes tombstones older than the retention cutoff. Called by the nightly maintenance
     * job; external event ids older than the retention window can no longer be replayed, which is
     * acceptable because producers re-submitting events that old would be re-opening settled
     * billing periods.
     *
     * @param cutoff delete tombstones consumed strictly before this instant
     * @return number of tombstones removed
     */
    @Modifying
    @Transactional
    long deleteByConsumedAtBefore(Instant cutoff);
}

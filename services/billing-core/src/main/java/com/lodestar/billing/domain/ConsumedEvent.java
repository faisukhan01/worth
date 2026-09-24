package com.lodestar.billing.domain;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Idempotency tombstone for metered usage events: one row per consumed external event id.
 *
 * <p><strong>Trade-off note.</strong> A durable tombstone table was chosen over an in-memory
 * {@code ConcurrentHashMap} because billing must never double-bill, and an in-process set forgets
 * everything on restart or behind a second replica. The cost is one small row per event and a
 * scheduled purge of keys past the retention window. In a high-throughput deployment this table
 * would be replaced by Redis {@code SET NX EX} (or DynamoDB conditionally-written keys) with a
 * TTL; the {@code MeteringService} contract would not change.
 */
@Entity
@Table(name = "consumed_events")
public class ConsumedEvent {

    @Id
    @Column(name = "event_id", nullable = false, length = 128, updatable = false)
    private String eventId;

    @Column(name = "consumed_at", nullable = false)
    private Instant consumedAt;

    protected ConsumedEvent() {
        // Required by JPA.
    }

    /**
     * @param eventId    producer-supplied external event id (idempotency key)
     * @param consumedAt UTC instant at which the event was first accepted
     */
    public ConsumedEvent(String eventId, Instant consumedAt) {
        this.eventId = eventId;
        this.consumedAt = consumedAt;
    }

    /** @return the external event id this tombstone reserves. */
    public String getEventId() {
        return eventId;
    }

    /** @return when the event was first accepted by the metering pipeline. */
    public Instant getConsumedAt() {
        return consumedAt;
    }
}

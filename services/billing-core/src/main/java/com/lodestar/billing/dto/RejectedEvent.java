package com.lodestar.billing.dto;

/**
 * One non-accepted event of an ingestion batch, with the reason it was not billed.
 *
 * @param externalId external id of the affected event (empty when the id itself was missing)
 * @param reason     machine-readable rejection or duplicate reason
 */
public record RejectedEvent(String externalId, String reason) {
}

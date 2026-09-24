package com.lodestar.billing.dto;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

/**
 * Request body of {@code POST /v1/usage/batch}.
 *
 * @param events usage events to meter; each event is validated and de-duplicated independently
 */
public record BatchUsageRequest(
        @NotEmpty(message = "events must not be empty")
        @Size(max = MeteringLimits.MAX_BATCH_SIZE, message = "a batch may contain at most 1000 events")
        @Valid
        List<UsageEvent> events) {

    /** Shared ceiling mirrored from {@code MeteringService.MAX_BATCH_SIZE} for bean validation. */
    public static final class MeteringLimits {
        /** Maximum number of events per batch. */
        public static final int MAX_BATCH_SIZE = 1000;

        private MeteringLimits() {
        }
    }
}

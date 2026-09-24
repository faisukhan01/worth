package com.lodestar.billing.dto;

import java.math.BigDecimal;

/**
 * Outcome of a quota evaluation. {@code remaining} and {@code limit} refer to the hard limit and
 * are {@code null} when no hard limit is configured. {@code reason} is one of:
 * {@code allowed}, {@code soft_limit_warning}, {@code hard_limit_exceeded}.
 *
 * @param allowed   whether the requested consumption may proceed
 * @param remaining head-room under the hard limit after this decision
 * @param limit     the hard limit in force, or {@code null} when unlimited
 * @param reason    machine-readable outcome code
 */
public record QuotaDecision(boolean allowed, BigDecimal remaining, BigDecimal limit, String reason) {
}

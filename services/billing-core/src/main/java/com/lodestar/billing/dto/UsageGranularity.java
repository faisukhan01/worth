package com.lodestar.billing.dto;

/**
 * Bucket size of a usage time series.
 */
public enum UsageGranularity {

    /** One bucket per UTC hour. */
    HOUR,

    /** One bucket per UTC day. */
    DAY
}

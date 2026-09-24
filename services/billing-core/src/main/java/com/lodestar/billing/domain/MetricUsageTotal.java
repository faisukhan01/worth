package com.lodestar.billing.domain;

import java.math.BigDecimal;

/**
 * Read projection returned by the usage aggregation queries: the summed quantity of a single
 * metric for one organisation within a time window.
 */
public interface MetricUsageTotal {

    /** @return billing metric name, e.g. {@code ingested.events}. */
    String getMetricName();

    /** @return measurement unit of the metric, e.g. {@code events} or {@code GB}. */
    String getUnit();

    /** @return summed quantity of the metric within the queried window. */
    BigDecimal getTotal();
}

package com.lodestar.billing.dto;

import java.math.BigDecimal;

/**
 * Total consumption of one metric within a reporting window.
 *
 * @param metricName billing metric name, e.g. {@code ingested.events}
 * @param unit       measurement unit of the quantity
 * @param total      summed quantity over the window
 */
public record MetricTotal(String metricName, String unit, BigDecimal total) {
}

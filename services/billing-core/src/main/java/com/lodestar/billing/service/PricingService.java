package com.lodestar.billing.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Service;

import com.lodestar.billing.domain.Plan;

/**
 * Central pricing rule book for Lodestar billing.
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>Declare the billable metric catalog (metric name, unit, divisor per billable unit).</li>
 *   <li>Resolve, per plan, the included allowance and the overage unit price of each metric.</li>
 *   <li>Price recurring charges: the plan base and per-seat charges, prorated to the billed
 *       period.</li>
 * </ul>
 *
 * <p>Every money amount in the service flows through this class so pricing changes stay in one
 * place. Metric allowances not present on the {@link Plan} enum (telemetry volume, AIOps
 * insights) are derived deterministically from the plan's declared fields, which keeps the plan
 * catalog small while still producing a complete invoice.
 */
@Service
public class PricingService {

    private static final BigDecimal INCLUDED_GB_PER_HOST = BigDecimal.valueOf(120);
    private static final BigDecimal INSIGHTS_PER_INCLUDED_EVENT = new BigDecimal("0.002");

    private static final Map<String, MetricDescriptor> METRICS = Map.of(
            "ingested.events",
            new MetricDescriptor("ingested.events", "Ingested events", "events",
                    BigDecimal.valueOf(1_000_000), "1M events", 0),
            "ingested.gb",
            new MetricDescriptor("ingested.gb", "Ingested telemetry volume", "GB",
                    BigDecimal.ONE, "GB", 2),
            "aiops.insights",
            new MetricDescriptor("aiops.insights", "AIOps insights generated", "insights",
                    BigDecimal.valueOf(1_000), "1K insights", 0));

    private static final Map<Plan, BigDecimal> GB_OVERAGE_PRICE = Map.of(
            Plan.STARTER, new BigDecimal("0.18"),
            Plan.PRO, new BigDecimal("0.12"),
            Plan.ENTERPRISE, new BigDecimal("0.08"));

    private static final Map<Plan, BigDecimal> INSIGHTS_OVERAGE_PRICE = Map.of(
            Plan.STARTER, new BigDecimal("1.20"),
            Plan.PRO, new BigDecimal("0.80"),
            Plan.ENTERPRISE, new BigDecimal("0.50"));

    private static final Map<Plan, Integer> INCLUDED_SEATS = Map.of(
            Plan.STARTER, 3,
            Plan.PRO, 10,
            Plan.ENTERPRISE, 25);

    private static final Map<Plan, BigDecimal> SEAT_PRICE = Map.of(
            Plan.STARTER, new BigDecimal("9.00"),
            Plan.PRO, new BigDecimal("15.00"),
            Plan.ENTERPRISE, new BigDecimal("25.00"));

    /**
     * Describes how one billing metric is metered and priced.
     *
     * @param metricName        canonical metric name as accepted by the metering API
     * @param displayName       human-readable name used on invoices
     * @param unit              measurement unit of the raw quantity
     * @param divisor           raw quantity units per billable unit (e.g. 1,000,000 events per
     *                          "1M events")
     * @param billableUnitLabel label of the billable unit used on invoices
     * @param displayDecimals   decimal places to use when rendering raw quantities on invoices
     */
    public record MetricDescriptor(String metricName, String displayName, String unit,
                                   BigDecimal divisor, String billableUnitLabel, int displayDecimals) {
    }

    /** @return the set of metric names accepted by the metering API. */
    public Set<String> knownMetrics() {
        return METRICS.keySet();
    }

    /**
     * @param metricName candidate metric name
     * @return {@code true} when the metric is billable by this service
     */
    public boolean isKnownMetric(String metricName) {
        return metricName != null && METRICS.containsKey(metricName);
    }

    /**
     * Resolves the pricing descriptor of a metric.
     *
     * @param metricName billing metric name
     * @return the descriptor of the metric
     * @throws IllegalArgumentException when the metric is unknown
     */
    public MetricDescriptor descriptor(String metricName) {
        MetricDescriptor descriptor = METRICS.get(metricName);
        if (descriptor == null) {
            throw new IllegalArgumentException("Unknown metric: " + metricName);
        }
        return descriptor;
    }

    /**
     * Resolves the monthly allowance of a metric for a plan.
     *
     * @param plan       subscribed plan
     * @param metricName billing metric name
     * @return included quantity per billing period, in the metric's raw unit
     * @throws IllegalArgumentException when the metric is unknown
     */
    public BigDecimal includedQuantity(Plan plan, String metricName) {
        return switch (metricName) {
            case "ingested.events" -> BigDecimal.valueOf(plan.getIncludedEventsPerMonth());
            case "ingested.gb" -> INCLUDED_GB_PER_HOST.multiply(BigDecimal.valueOf(plan.getIncludedHosts()));
            case "aiops.insights" -> BigDecimal.valueOf(plan.getIncludedEventsPerMonth())
                    .multiply(INSIGHTS_PER_INCLUDED_EVENT);
            default -> throw new IllegalArgumentException("Unknown metric: " + metricName);
        };
    }

    /**
     * Resolves the overage price per billable unit of a metric for a plan. Event overage uses the
     * per-plan {@code perMillionOverage} field; the other metrics use a per-plan rate card held
     * here.
     *
     * @param plan       subscribed plan
     * @param metricName billing metric name
     * @return price in USD per billable unit above the included allowance
     * @throws IllegalArgumentException when the metric is unknown
     */
    public BigDecimal overageUnitPrice(Plan plan, String metricName) {
        return switch (metricName) {
            case "ingested.events" -> plan.getPerMillionOverage();
            case "ingested.gb" -> GB_OVERAGE_PRICE.get(plan);
            case "aiops.insights" -> INSIGHTS_OVERAGE_PRICE.get(plan);
            default -> throw new IllegalArgumentException("Unknown metric: " + metricName);
        };
    }

    /**
     * Converts a raw quantity into billable units, e.g. 12,600,000 events become 12.6
     * "1M events" units.
     *
     * @param quantity   raw consumed quantity in the metric's unit
     * @param metricName billing metric name
     * @return billable units at six decimal places
     * @throws IllegalArgumentException when the metric is unknown
     */
    public BigDecimal billableUnits(BigDecimal quantity, String metricName) {
        MetricDescriptor descriptor = descriptor(metricName);
        return quantity.divide(descriptor.divisor(), 6, RoundingMode.HALF_UP);
    }

    /** @return number of user seats included in the plan's base price. */
    public int includedSeats(Plan plan) {
        return INCLUDED_SEATS.get(plan);
    }

    /** @return monthly price per seat beyond the plan's included seats. */
    public BigDecimal seatPrice(Plan plan) {
        return SEAT_PRICE.get(plan);
    }

    /**
     * Computes the proration factor of a billing period relative to a full calendar month:
     * {@code periodSeconds / daysInMonth(periodStart) * 86400}, capped at 1. A full-month period
     * yields exactly 1; a 30-day period billed inside a 31-day month yields ~0.9677.
     *
     * @param periodStart inclusive start of the billed period (UTC)
     * @param periodEnd   exclusive end of the billed period (UTC)
     * @return proration factor in [0, 1] at six decimal places
     */
    public BigDecimal prorationFactor(Instant periodStart, Instant periodEnd) {
        int daysInMonth = YearMonth.from(periodStart.atZone(ZoneOffset.UTC)).lengthOfMonth();
        BigDecimal periodSeconds = BigDecimal.valueOf(Duration.between(periodStart, periodEnd).getSeconds());
        BigDecimal monthSeconds = BigDecimal.valueOf(daysInMonth * 86_400L);
        BigDecimal factor = periodSeconds.divide(monthSeconds, 6, RoundingMode.HALF_UP);
        return factor.min(BigDecimal.ONE);
    }
}

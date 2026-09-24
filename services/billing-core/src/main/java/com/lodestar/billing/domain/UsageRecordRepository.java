package com.lodestar.billing.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Repository for the append-only {@link UsageRecord} ledger.
 *
 * <p>Aggregations are pushed into the database (JPQL {@code sum ... group by}) because invoices
 * and quota counters only ever need per-metric totals, not raw rows.
 */
public interface UsageRecordRepository extends JpaRepository<UsageRecord, UUID> {

    /**
     * Sums usage quantity per metric for an organisation within a half-open window
     * {@code [from, to)}.
     *
     * @param orgId billing organisation identifier
     * @param from  inclusive window start
     * @param to    exclusive window end
     * @return one row per metric present in the window, grouped by metric name and unit
     */
    @Query("""
            select r.metricName as metricName, r.unit as unit, sum(r.quantity) as total
            from UsageRecord r
            where r.orgId = :orgId and r.recordedAt >= :from and r.recordedAt < :to
            group by r.metricName, r.unit
            """)
    List<MetricUsageTotal> sumUsageByMetric(@Param("orgId") String orgId,
                                            @Param("from") Instant from,
                                            @Param("to") Instant to);

    /**
     * Sums usage quantity of a single metric for an organisation within a half-open window.
     *
     * @param orgId      billing organisation identifier
     * @param metricName billing metric name
     * @param from       inclusive window start
     * @param to         exclusive window end
     * @return the summed quantity, or {@code null} when no usage exists in the window
     */
    @Query("""
            select sum(r.quantity)
            from UsageRecord r
            where r.orgId = :orgId and r.metricName = :metricName
              and r.recordedAt >= :from and r.recordedAt < :to
            """)
    BigDecimal sumUsageForMetric(@Param("orgId") String orgId,
                                 @Param("metricName") String metricName,
                                 @Param("from") Instant from,
                                 @Param("to") Instant to);

    /**
     * Loads the raw usage rows of an organisation within a half-open window in chronological
     * order. Used for time-bucketed (hourly / daily) rollups, which are computed in the service
     * layer so the same code path works against H2 in dev and a warehouse in production.
     *
     * @param orgId billing organisation identifier
     * @param from  inclusive window start
     * @param to    exclusive window end
     * @return usage rows ordered by {@code recordedAt}
     */
    List<UsageRecord> findByOrgIdAndRecordedAtGreaterThanEqualAndRecordedAtLessThanOrderByRecordedAtAsc(
            String orgId, Instant from, Instant to);
}

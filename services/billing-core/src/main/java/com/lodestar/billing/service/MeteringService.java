package com.lodestar.billing.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lodestar.billing.domain.ConsumedEvent;
import com.lodestar.billing.domain.ConsumedEventRepository;
import com.lodestar.billing.domain.MetricUsageTotal;
import com.lodestar.billing.domain.Subscription;
import com.lodestar.billing.domain.SubscriptionRepository;
import com.lodestar.billing.domain.UsageRecord;
import com.lodestar.billing.domain.UsageRecordRepository;
import com.lodestar.billing.dto.BatchUsageRequest;
import com.lodestar.billing.dto.BatchUsageResponse;
import com.lodestar.billing.dto.MetricTotal;
import com.lodestar.billing.dto.QuotaDecision;
import com.lodestar.billing.dto.RejectedEvent;
import com.lodestar.billing.dto.UsageEvent;
import com.lodestar.billing.dto.UsageGranularity;
import com.lodestar.billing.dto.UsagePoint;
import com.lodestar.billing.dto.UsageSummary;

/**
 * Ingestion and aggregation pipeline for metered usage.
 *
 * <p><strong>Ingestion.</strong> Batches of {@link UsageEvent} are validated, de-duplicated and
 * persisted to the append-only usage ledger. Idempotency is enforced per external event id via
 * the {@link ConsumedEvent} tombstone table, so producers can safely retry batches after network
 * failures. Individual invalid events are rejected without failing the whole batch; only
 * batch-level problems (oversized batches) raise an error.
 *
 * <p><strong>Quota coupling.</strong> Before persisting, the batch is aggregated per
 * {@code (org, metric)} and checked against {@link QuotaService}. Quota decisions are
 * all-or-nothing per group within a batch: if the hard limit would be exceeded, that group's
 * events are rejected with a quota reason and the rest of the batch is still admitted.
 *
 * <p><strong>Rollups.</strong> Per-metric totals are aggregated in the database; hourly and
 * daily time series are bucketed in memory from the bounded ledger window of a single
 * organisation. At the volumes where in-memory bucketing stops being acceptable, this method is
 * the single seam to replace with a warehouse query (Timescale/ClickHouse) - the API contract
 * does not change.
 */
@Service
public class MeteringService {

    private static final Logger log = LoggerFactory.getLogger(MeteringService.class);

    /** Hard ceiling on batch size; protects the transaction and the H2 dev database. */
    public static final int MAX_BATCH_SIZE = 1000;

    private static final Duration MAX_CLOCK_SKEW = Duration.ofMinutes(5);
    private static final Duration MAX_EVENT_AGE = Duration.ofDays(90);
    private static final Duration CONSUMED_EVENT_RETENTION = Duration.ofDays(90);

    private final UsageRecordRepository usageRecordRepository;
    private final ConsumedEventRepository consumedEventRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final QuotaService quotaService;
    private final PricingService pricingService;
    private final Clock clock;

    public MeteringService(UsageRecordRepository usageRecordRepository,
                           ConsumedEventRepository consumedEventRepository,
                           SubscriptionRepository subscriptionRepository,
                           QuotaService quotaService,
                           PricingService pricingService,
                           Clock clock) {
        this.usageRecordRepository = usageRecordRepository;
        this.consumedEventRepository = consumedEventRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.quotaService = quotaService;
        this.pricingService = pricingService;
        this.clock = clock;
    }

    /**
     * Ingests a batch of usage events idempotently.
     *
     * <p>Outcome per event: accepted (persisted), duplicate (external id already consumed in a
     * previous batch or earlier in this batch), or rejected (validation or hard quota). The
     * response reports all three categories so callers can audit exactly what was billed.
     *
     * @param request batch of usage events
     * @return per-category counters plus one entry per non-accepted event
     * @throws IllegalArgumentException when the batch exceeds {@link #MAX_BATCH_SIZE}
     */
    @Transactional
    public BatchUsageResponse ingestBatch(BatchUsageRequest request) {
        List<UsageEvent> events = request.events();
        if (events.size() > MAX_BATCH_SIZE) {
            throw new IllegalArgumentException(
                    "Batch size " + events.size() + " exceeds the maximum of " + MAX_BATCH_SIZE + " events");
        }

        int received = events.size();
        List<RejectedEvent> issues = new ArrayList<>();

        // Drop malformed ids first so the idempotency lookup below stays safe.
        List<UsageEvent> identified = new ArrayList<>(events.size());
        for (UsageEvent event : events) {
            if (event.externalId() == null || event.externalId().isBlank()) {
                issues.add(new RejectedEvent("", "missing externalId"));
            } else {
                identified.add(event);
            }
        }

        // De-duplicate within the batch: the first occurrence of an external id wins.
        Set<String> seenInBatch = new HashSet<>();
        List<UsageEvent> candidates = new ArrayList<>(identified.size());
        for (UsageEvent event : identified) {
            if (!seenInBatch.add(event.externalId())) {
                issues.add(new RejectedEvent(event.externalId(), "duplicate external id within batch"));
            } else {
                candidates.add(event);
            }
        }

        // Events already consumed in a previous batch are acknowledged, never re-billed.
        Set<String> consumedIds = consumedEventRepository
                .findAllById(candidates.stream().map(UsageEvent::externalId).toList())
                .stream()
                .map(ConsumedEvent::getEventId)
                .collect(java.util.stream.Collectors.toSet());

        List<UsageEvent> valid = new ArrayList<>(candidates.size());
        int duplicates = 0;
        Map<String, Boolean> knownOrgs = new HashMap<>();
        for (UsageEvent event : candidates) {
            if (consumedIds.contains(event.externalId())) {
                duplicates++;
                issues.add(new RejectedEvent(event.externalId(), "duplicate external id (already ingested)"));
                continue;
            }
            String rejection = validate(event);
            if (rejection != null) {
                issues.add(new RejectedEvent(event.externalId(), rejection));
                continue;
            }
            Boolean knownOrg = knownOrgs.computeIfAbsent(event.orgId(), subscriptionRepository::existsByOrgId);
            if (!knownOrg) {
                issues.add(new RejectedEvent(event.externalId(), "unknown organization " + event.orgId()));
                continue;
            }
            valid.add(event);
        }

        // Quota gate: aggregate the batch per (org, metric) and enforce once per group.
        Map<GroupKey, BigDecimal> additionalByGroup = new LinkedHashMap<>();
        for (UsageEvent event : valid) {
            additionalByGroup.merge(new GroupKey(event.orgId(), event.metricName()),
                    event.quantity(), BigDecimal::add);
        }
        Set<GroupKey> blockedGroups = new HashSet<>();
        for (Map.Entry<GroupKey, BigDecimal> entry : additionalByGroup.entrySet()) {
            QuotaDecision decision = quotaService.enforceQuota(
                    entry.getKey().orgId(), entry.getKey().metricName(), entry.getValue());
            if (!decision.allowed()) {
                blockedGroups.add(entry.getKey());
            }
        }

        Instant now = Instant.now(clock);
        List<UsageRecord> records = new ArrayList<>(valid.size());
        List<ConsumedEvent> tombstones = new ArrayList<>(valid.size());
        int accepted = 0;
        for (UsageEvent event : valid) {
            if (blockedGroups.contains(new GroupKey(event.orgId(), event.metricName()))) {
                issues.add(new RejectedEvent(event.externalId(),
                        "hard quota exceeded for metric " + event.metricName()));
                continue;
            }
            PricingService.MetricDescriptor descriptor = pricingService.descriptor(event.metricName());
            String unit = event.unit() == null || event.unit().isBlank()
                    ? descriptor.unit()
                    : event.unit();
            records.add(toRecord(event, unit));
            tombstones.add(new ConsumedEvent(event.externalId(), now));
            accepted++;
        }

        if (!records.isEmpty()) {
            usageRecordRepository.saveAll(records);
        }
        if (!tombstones.isEmpty()) {
            consumedEventRepository.saveAll(tombstones);
        }

        int rejected = received - accepted - duplicates;
        log.info("Usage batch ingested: received={}, accepted={}, duplicates={}, rejected={}",
                received, accepted, duplicates, rejected);
        return new BatchUsageResponse(received, accepted, duplicates, rejected, List.copyOf(issues));
    }

    /**
     * Aggregates usage of the currently open billing period of an organisation.
     *
     * @param orgId billing organisation identifier
     * @return per-metric totals plus a daily time series over the open period
     * @throws java.util.NoSuchElementException when the organisation has no subscription
     */
    @Transactional(readOnly = true)
    public UsageSummary currentPeriodUsage(String orgId) {
        Subscription subscription = requireSubscription(orgId);
        return buildSummary(subscription, subscription.getCurrentPeriodStart(),
                subscription.getCurrentPeriodEnd(), UsageGranularity.DAY);
    }

    /**
     * Aggregates usage for an explicit period. When {@code period} is {@code null} the currently
     * open billing period is used; otherwise {@code period} is interpreted as a UTC calendar
     * month.
     *
     * @param orgId       billing organisation identifier
     * @param period      calendar month in {@code yyyy-MM} format, or {@code null} for the open period
     * @param granularity bucket size of the returned time series
     * @return per-metric totals plus the bucketed time series
     * @throws java.util.NoSuchElementException when the organisation has no subscription
     */
    @Transactional(readOnly = true)
    public UsageSummary usageSummary(String orgId, YearMonth period, UsageGranularity granularity) {
        Subscription subscription = requireSubscription(orgId);
        Instant from = period == null
                ? subscription.getCurrentPeriodStart()
                : period.atDay(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant to = period == null
                ? subscription.getCurrentPeriodEnd()
                : period.plusMonths(1).atDay(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        return buildSummary(subscription, from, to, granularity);
    }

    /**
     * Nightly maintenance: expires idempotency tombstones past the retention window so the table
     * stays proportional to recent traffic.
     */
    @Scheduled(cron = "${lodestar.billing.purge-cron:0 0 3 * * *}")
    public void purgeExpiredIdempotencyTombstones() {
        try {
            long removed = consumedEventRepository.deleteByConsumedAtBefore(
                    Instant.now(clock).minus(CONSUMED_EVENT_RETENTION));
            if (removed > 0) {
                log.info("Purged {} consumed-event tombstones older than {} days",
                        removed, CONSUMED_EVENT_RETENTION.toDays());
            }
        } catch (Exception ex) {
            log.error("Failed to purge consumed-event tombstones", ex);
        }
    }

    private String validate(UsageEvent event) {
        if (event.orgId() == null || event.orgId().isBlank()) {
            return "missing orgId";
        }
        if (event.serviceId() == null || event.serviceId().isBlank()) {
            return "missing serviceId";
        }
        if (!pricingService.isKnownMetric(event.metricName())) {
            return "unknown metric " + event.metricName();
        }
        if (event.quantity() == null || event.quantity().signum() <= 0) {
            return "quantity must be positive";
        }
        Instant now = Instant.now(clock);
        if (event.recordedAt() == null) {
            return "missing recordedAt";
        }
        if (event.recordedAt().isAfter(now.plus(MAX_CLOCK_SKEW))) {
            return "recordedAt is too far in the future";
        }
        if (event.recordedAt().isBefore(now.minus(MAX_EVENT_AGE))) {
            return "recordedAt is older than " + MAX_EVENT_AGE.toDays() + " days";
        }
        return null;
    }

    private UsageRecord toRecord(UsageEvent event, String unit) {
        UsageRecord record = new UsageRecord();
        record.setOrgId(event.orgId());
        record.setServiceId(event.serviceId());
        record.setMetricName(event.metricName());
        record.setUnit(unit);
        record.setQuantity(event.quantity());
        record.setRecordedAt(event.recordedAt());
        return record;
    }

    private Subscription requireSubscription(String orgId) {
        return subscriptionRepository.findByOrgId(orgId)
                .orElseThrow(() -> new java.util.NoSuchElementException("No subscription found for org " + orgId));
    }

    private UsageSummary buildSummary(Subscription subscription, Instant from, Instant to,
                                      UsageGranularity granularity) {
        String orgId = subscription.getOrgId();

        List<MetricTotal> totals = usageRecordRepository.sumUsageByMetric(orgId, from, to).stream()
                .map(total -> new MetricTotal(total.getMetricName(), total.getUnit(),
                        total.getTotal() == null ? BigDecimal.ZERO : total.getTotal()))
                .sorted(java.util.Comparator.comparing(MetricTotal::metricName))
                .toList();

        Map<String, Map<Instant, BigDecimal>> seriesByMetric = new java.util.TreeMap<>();
        for (UsageRecord record : usageRecordRepository
                .findByOrgIdAndRecordedAtGreaterThanEqualAndRecordedAtLessThanOrderByRecordedAtAsc(orgId, from, to)) {
            Instant bucket = record.getRecordedAt().truncatedTo(granularity == UsageGranularity.HOUR
                    ? ChronoUnit.HOURS
                    : ChronoUnit.DAYS);
            seriesByMetric
                    .computeIfAbsent(record.getMetricName(), k -> new java.util.TreeMap<>())
                    .merge(bucket, record.getQuantity(), BigDecimal::add);
        }

        List<UsagePoint> series = new ArrayList<>();
        for (Map.Entry<String, Map<Instant, BigDecimal>> metricEntry : seriesByMetric.entrySet()) {
            for (Map.Entry<Instant, BigDecimal> bucketEntry : metricEntry.getValue().entrySet()) {
                series.add(new UsagePoint(metricEntry.getKey(), bucketEntry.getKey(), bucketEntry.getValue()));
            }
        }

        return new UsageSummary(orgId, subscription.getPlan().name(), from, to, totals, series);
    }

    private record GroupKey(String orgId, String metricName) {
    }
}

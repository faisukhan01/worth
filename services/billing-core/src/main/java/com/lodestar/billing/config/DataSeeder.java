package com.lodestar.billing.config;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.lodestar.billing.domain.Plan;
import com.lodestar.billing.domain.Subscription;
import com.lodestar.billing.domain.SubscriptionRepository;
import com.lodestar.billing.domain.SubscriptionStatus;
import com.lodestar.billing.domain.UsageRecord;
import com.lodestar.billing.domain.UsageRecordRepository;
import com.lodestar.billing.service.PricingService;
import com.lodestar.billing.service.QuotaService;

/**
 * Seeds a demo tenant on first boot so the service is explorable without an upstream producer.
 *
 * <p>Created state:
 * <ul>
 *   <li>{@code org_demo} on the {@code PRO} plan with a calendar-month billing period and 12
 *       seats (2 beyond the plan's included seats, so additional-seat line items appear on
 *       generated invoices).</li>
 *   <li>Thirty days of hourly usage records per billable metric with diurnal, weekend and growth
 *       variation. Quantities are tuned so the PRO plan lands above its included allowances,
 *       exercising the overage pricing path.</li>
 *   <li>Quota states for every seeded metric, with the consumption counter resynchronised from
 *       the usage ledger after the historical data has been written.</li>
 * </ul>
 *
 * <p>Seeding is skipped when the demo organisation already exists, so restarts are idempotent
 * and manually created tenants are never clobbered.
 */
@Component
@ConditionalOnProperty(name = "lodestar.billing.seed.enabled", havingValue = "true")
public class DataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    /** Organisation id of the demo tenant created on first boot. */
    public static final String DEMO_ORG_ID = "org_demo";

    private static final int SEED_HOURS = 30 * 24;
    private static final int INSERT_CHUNK_SIZE = 500;
    private static final int DEMO_SEATS = 12;
    private static final long SEED = 42L;
    private static final int QUANTITY_SCALE = 6;

    /** One simulated workload: which metric is billed, who produces it, and its base hourly volume. */
    private record SimulatedWorkload(String metricName, String serviceId, double hourlyBase) {
    }

    /**
     * Workloads approximate a small production estate: steady event ingestion with diurnal and
     * weekend variation, telemetry volume proportional to it, and AIOps insights derived from
     * ingested events. Base rates assume the diurnal (mean 1.0), weekend (mean ~0.87) and growth
     * (mean ~1.5) factors roughly cancel out over the month.
     */
    private static final List<SimulatedWorkload> WORKLOADS = List.of(
            new SimulatedWorkload("ingested.events", "ingest-gateway", 72_000),
            new SimulatedWorkload("ingested.gb", "ingest-gateway", 2.6),
            new SimulatedWorkload("aiops.insights", "aiops-engine", 140));

    private final SubscriptionRepository subscriptionRepository;
    private final UsageRecordRepository usageRecordRepository;
    private final PricingService pricingService;
    private final QuotaService quotaService;
    private final Clock clock;

    public DataSeeder(SubscriptionRepository subscriptionRepository,
                      UsageRecordRepository usageRecordRepository,
                      PricingService pricingService,
                      QuotaService quotaService,
                      Clock clock) {
        this.subscriptionRepository = subscriptionRepository;
        this.usageRecordRepository = usageRecordRepository;
        this.pricingService = pricingService;
        this.quotaService = quotaService;
        this.clock = clock;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (subscriptionRepository.existsByOrgId(DEMO_ORG_ID)) {
            log.info("Demo tenant {} already present; seeding skipped", DEMO_ORG_ID);
            return;
        }

        Instant now = Instant.now(clock).truncatedTo(ChronoUnit.HOURS);
        Subscription subscription = seedSubscription(now);
        long usageRecords = seedUsage(now);
        seedQuotas(subscription);

        log.info("Seeded demo tenant: org={}, plan={}, seats={}, usage records={}",
                DEMO_ORG_ID, subscription.getPlan(), subscription.getSeats(), usageRecords);
    }

    private Subscription seedSubscription(Instant now) {
        Instant periodStart = now.atZone(ZoneOffset.UTC).toLocalDate().withDayOfMonth(1)
                .atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant periodEnd = YearMonth.from(periodStart.atZone(ZoneOffset.UTC)).plusMonths(1)
                .atDay(1).atStartOfDay(ZoneOffset.UTC).toInstant();

        Subscription subscription = new Subscription();
        subscription.setOrgId(DEMO_ORG_ID);
        subscription.setPlan(Plan.PRO);
        subscription.setCurrentPeriodStart(periodStart);
        subscription.setCurrentPeriodEnd(periodEnd);
        subscription.setSeats(DEMO_SEATS);
        subscription.setStatus(SubscriptionStatus.ACTIVE);
        subscription.setCreatedAt(now);
        return subscriptionRepository.save(subscription);
    }

    private long seedUsage(Instant now) {
        Random random = new Random(SEED);
        List<UsageRecord> records = new ArrayList<>();
        for (SimulatedWorkload workload : WORKLOADS) {
            if (!pricingService.isKnownMetric(workload.metricName())) {
                log.warn("Metric {} is no longer billable; skipping its seeded usage", workload.metricName());
                continue;
            }
            String unit = pricingService.descriptor(workload.metricName()).unit();
            // Oldest hour first so the ledger is strictly chronological.
            for (int hoursAgo = SEED_HOURS - 1; hoursAgo >= 0; hoursAgo--) {
                Instant hour = now.minus(hoursAgo, ChronoUnit.HOURS);
                records.add(toRecord(workload, unit, hour,
                        hourlyQuantity(workload.hourlyBase(), hour, hoursAgo, random)));
            }
        }
        for (int from = 0; from < records.size(); from += INSERT_CHUNK_SIZE) {
            usageRecordRepository.saveAll(records.subList(from, Math.min(from + INSERT_CHUNK_SIZE, records.size())));
        }
        return records.size();
    }

    private void seedQuotas(Subscription subscription) {
        // Recompute initialises each quota row and synchronises the consumption counter with the
        // usage ledger written above (plan-derived defaults: hard = 150% of included, soft = 80%).
        for (SimulatedWorkload workload : WORKLOADS) {
            if (!pricingService.isKnownMetric(workload.metricName())) {
                continue;
            }
            quotaService.recomputeConsumed(subscription.getOrgId(), workload.metricName());
        }
        // One explicit operator override so the admin PUT path has visible state to manage.
        quotaService.upsert(subscription.getOrgId(), "aiops.insights",
                new BigDecimal("100000"), new BigDecimal("125000"));
    }

    private BigDecimal hourlyQuantity(double hourlyBase, Instant hour, int hoursAgo, Random random) {
        ZonedDateTime utc = hour.atZone(ZoneOffset.UTC);
        boolean weekend = utc.getDayOfWeek() == DayOfWeek.SATURDAY || utc.getDayOfWeek() == DayOfWeek.SUNDAY;
        double diurnal = 1.0 + 0.3 * Math.sin(2 * Math.PI * (utc.getHour() - 8) / 24.0);
        double weekendFactor = weekend ? 0.55 : 1.0;
        double growth = 1.0 + (double) (SEED_HOURS - hoursAgo) / SEED_HOURS;
        double noise = 0.9 + 0.2 * random.nextDouble();
        double quantity = hourlyBase * diurnal * weekendFactor * growth * noise;
        return BigDecimal.valueOf(quantity).setScale(QUANTITY_SCALE, RoundingMode.HALF_UP);
    }

    private UsageRecord toRecord(SimulatedWorkload workload, String unit, Instant hour, BigDecimal quantity) {
        UsageRecord record = new UsageRecord();
        record.setOrgId(DEMO_ORG_ID);
        record.setServiceId(workload.serviceId());
        record.setMetricName(workload.metricName());
        record.setUnit(unit);
        record.setQuantity(quantity);
        record.setRecordedAt(hour);
        return record;
    }
}

package com.lodestar.billing.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lodestar.billing.domain.QuotaKey;
import com.lodestar.billing.domain.QuotaState;
import com.lodestar.billing.domain.QuotaStateRepository;
import com.lodestar.billing.domain.Subscription;
import com.lodestar.billing.domain.SubscriptionRepository;
import com.lodestar.billing.domain.UsageRecordRepository;
import com.lodestar.billing.dto.QuotaDecision;
import com.lodestar.billing.dto.QuotaStateView;

/**
 * Two-tier quota enforcement for metered metrics.
 *
 * <p>Quotas are evaluated against a fast-path counter ({@code QuotaState.consumedThisPeriod})
 * instead of re-aggregating the usage ledger on every call. The counter is re-synchronised from
 * the ledger whenever the billing period rolls over, so transient drift self-heals and the
 * durable usage records always remain the source of truth for invoicing.
 *
 * <p>Semantics:
 * <ul>
 *   <li>{@code hardLimit} reached or exceeded: the request is <em>blocked</em> and consumption is
 *       not incremented.</li>
 *   <li>{@code softLimit} (default 80% of the hard limit) reached: the request is allowed but the
 *       decision carries a warning reason.</li>
 *   <li>Unconfigured limits are derived from the subscription plan: hard limit at 150% of the
 *       included allowance, soft limit at 80% of the hard limit.</li>
 * </ul>
 */
@Service
public class QuotaService {

    private static final BigDecimal DEFAULT_HARD_LIMIT_MULTIPLIER = new BigDecimal("1.5");
    private static final BigDecimal DEFAULT_SOFT_LIMIT_RATIO = new BigDecimal("0.8");
    private static final int SCALE = 6;

    /** Discrete outcomes produced by {@link #enforceQuota(String, String, BigDecimal)}. */
    private enum QuotaReason {

        /** Usage admitted below all configured limits. */
        ALLOWED("allowed"),

        /** Usage admitted at or above the soft limit; the customer should be warned. */
        SOFT_LIMIT_WARNING("soft_limit_warning"),

        /** Usage rejected because the hard limit would be exceeded. */
        HARD_LIMIT_EXCEEDED("hard_limit_exceeded");

        private final String code;

        QuotaReason(String code) {
            this.code = code;
        }
    }

    private final QuotaStateRepository quotaStateRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final UsageRecordRepository usageRecordRepository;
    private final PricingService pricingService;

    public QuotaService(QuotaStateRepository quotaStateRepository,
                        SubscriptionRepository subscriptionRepository,
                        UsageRecordRepository usageRecordRepository,
                        PricingService pricingService) {
        this.quotaStateRepository = quotaStateRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.usageRecordRepository = usageRecordRepository;
        this.pricingService = pricingService;
    }

    /**
     * Evaluates whether {@code additional} units of a metric may be consumed by an organisation
     * and, when allowed, commits them to the fast-path counter.
     *
     * @param orgId      billing organisation identifier
     * @param metricName billing metric name
     * @param additional quantity about to be consumed; must be non-negative
     * @return the decision with allowance, remaining head-room and reason code
     * @throws IllegalArgumentException when the metric is unknown or the quantity is negative
     * @throws NoSuchElementException   when the organisation has no subscription
     */
    @Transactional
    public QuotaDecision enforceQuota(String orgId, String metricName, BigDecimal additional) {
        pricingService.descriptor(metricName); // validates the metric
        if (additional == null || additional.signum() < 0) {
            throw new IllegalArgumentException("additional must be a non-negative quantity");
        }
        Subscription subscription = requireSubscription(orgId);
        QuotaState state = loadOrCreate(subscription, metricName);
        rollForward(state, subscription, metricName);

        BigDecimal consumed = state.getConsumedThisPeriod();
        BigDecimal projected = consumed.add(additional);
        BigDecimal hardLimit = state.getHardLimit();
        Instant now = Instant.now();
        state.setLastEnforcedAt(now);

        if (hardLimit != null && projected.compareTo(hardLimit) > 0) {
            state.setConsumedThisPeriod(consumed);
            quotaStateRepository.save(state);
            return new QuotaDecision(false, remaining(hardLimit, consumed), hardLimit,
                    QuotaReason.HARD_LIMIT_EXCEEDED.code);
        }

        state.setConsumedThisPeriod(projected);
        quotaStateRepository.save(state);

        BigDecimal softLimit = state.getSoftLimit();
        if (softLimit != null && projected.compareTo(softLimit) >= 0) {
            return new QuotaDecision(true, remaining(hardLimit, projected), hardLimit,
                    QuotaReason.SOFT_LIMIT_WARNING.code);
        }
        return new QuotaDecision(true, remaining(hardLimit, projected), hardLimit,
                QuotaReason.ALLOWED.code);
    }

    /**
     * Creates or updates the explicit quota limits of one {@code (org, metric)} pair (admin
     * override). Parameters left {@code null} keep the current value; a newly created row falls
     * back to the plan-derived defaults.
     *
     * @param orgId      billing organisation identifier
     * @param metricName billing metric name
     * @param softLimit  new soft limit, or {@code null} to keep the current one
     * @param hardLimit  new hard limit, or {@code null} to keep the current one
     * @return the persisted quota state
     * @throws IllegalArgumentException when the metric is unknown or soft limit exceeds hard limit
     * @throws NoSuchElementException   when the organisation has no subscription
     */
    @Transactional
    public QuotaStateView upsert(String orgId, String metricName, BigDecimal softLimit, BigDecimal hardLimit) {
        pricingService.descriptor(metricName); // validates the metric
        Subscription subscription = requireSubscription(orgId);
        QuotaState state = loadOrCreate(subscription, metricName);
        if (hardLimit != null) {
            state.setHardLimit(hardLimit);
        }
        if (softLimit != null) {
            state.setSoftLimit(softLimit);
        }
        if (state.getSoftLimit() != null && state.getHardLimit() != null
                && state.getSoftLimit().compareTo(state.getHardLimit()) > 0) {
            throw new IllegalArgumentException("softLimit may not exceed hardLimit for metric " + metricName);
        }
        return toView(quotaStateRepository.save(state));
    }

    /**
     * Re-synchronises the fast-path counter of one quota from the usage ledger, regardless of
     * when the quota row was created. Used by the data seeder after historical usage has been
     * written and exposed for operational repair of a drifted counter.
     *
     * @param orgId      billing organisation identifier
     * @param metricName billing metric name
     * @return the refreshed quota state
     * @throws NoSuchElementException   when the organisation has no subscription
     * @throws IllegalArgumentException when the metric is unknown
     */
    @Transactional
    public QuotaStateView recomputeConsumed(String orgId, String metricName) {
        pricingService.descriptor(metricName); // validates the metric
        Subscription subscription = requireSubscription(orgId);
        QuotaState state = loadOrCreate(subscription, metricName);
        state.setPeriodStart(subscription.getCurrentPeriodStart());
        syncCounterFromLedger(state, subscription, metricName);
        return toView(quotaStateRepository.save(state));
    }

    /**
     * Lists all configured quotas of an organisation.
     *
     * @param orgId billing organisation identifier
     * @return quota states ordered by metric name; empty when none were configured yet
     */
    @Transactional(readOnly = true)
    public List<QuotaStateView> listForOrg(String orgId) {
        return quotaStateRepository.findByKeyOrgIdOrderByKeyMetricNameAsc(orgId).stream()
                .map(this::toView)
                .toList();
    }

    private Subscription requireSubscription(String orgId) {
        return subscriptionRepository.findByOrgId(orgId)
                .orElseThrow(() -> new NoSuchElementException("No subscription found for org " + orgId));
    }

    private QuotaState loadOrCreate(Subscription subscription, String metricName) {
        QuotaKey key = new QuotaKey(subscription.getOrgId(), metricName);
        return quotaStateRepository.findById(key).orElseGet(() -> {
            QuotaState state = new QuotaState();
            state.setKey(key);
            BigDecimal included = pricingService.includedQuantity(subscription.getPlan(), metricName);
            BigDecimal hardLimit = included.multiply(DEFAULT_HARD_LIMIT_MULTIPLIER).setScale(SCALE, RoundingMode.HALF_UP);
            state.setHardLimit(hardLimit);
            state.setSoftLimit(hardLimit.multiply(DEFAULT_SOFT_LIMIT_RATIO).setScale(SCALE, RoundingMode.HALF_UP));
            state.setConsumedThisPeriod(BigDecimal.ZERO);
            state.setPeriodStart(subscription.getCurrentPeriodStart());
            return state;
        });
    }

    private void rollForward(QuotaState state, Subscription subscription, String metricName) {
        if (subscription.getCurrentPeriodStart().equals(state.getPeriodStart())) {
            return;
        }
        // Billing period rolled over: rebuild the counter from the durable ledger instead of
        // zeroing it, so late-arriving usage for the new period is not lost.
        state.setPeriodStart(subscription.getCurrentPeriodStart());
        syncCounterFromLedger(state, subscription, metricName);
    }

    private void syncCounterFromLedger(QuotaState state, Subscription subscription, String metricName) {
        BigDecimal consumed = usageRecordRepository.sumUsageForMetric(
                subscription.getOrgId(), metricName,
                subscription.getCurrentPeriodStart(), Instant.now());
        state.setConsumedThisPeriod(consumed == null ? BigDecimal.ZERO : consumed);
    }

    private static BigDecimal remaining(BigDecimal limit, BigDecimal consumed) {
        return limit.subtract(consumed).max(BigDecimal.ZERO);
    }

    private QuotaStateView toView(QuotaState state) {
        QuotaKey key = state.getKey();
        return new QuotaStateView(key.getOrgId(), key.getMetricName(),
                state.getSoftLimit(), state.getHardLimit(), state.getConsumedThisPeriod(),
                state.getPeriodStart(), state.getLastEnforcedAt());
    }
}

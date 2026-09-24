package com.lodestar.billing.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.type.CollectionType;
import com.lodestar.billing.domain.Invoice;
import com.lodestar.billing.domain.InvoiceRepository;
import com.lodestar.billing.domain.InvoiceStatus;
import com.lodestar.billing.domain.MetricUsageTotal;
import com.lodestar.billing.domain.Plan;
import com.lodestar.billing.domain.Subscription;
import com.lodestar.billing.domain.SubscriptionRepository;
import com.lodestar.billing.domain.UsageRecordRepository;
import com.lodestar.billing.dto.InvoiceView;
import com.lodestar.billing.dto.LineItem;
import com.lodestar.billing.dto.LineItemKind;
import com.lodestar.billing.dto.LineItemView;

/**
 * Invoice generation and lifecycle management.
 *
 * <p>An invoice for one period consists of recurring charges (prorated plan base plus
 * additional seats) and per-metric usage overage above the plan's included allowances. The
 * rendered line items are persisted as a JSON document so issued invoices remain an immutable,
 * auditable artefact even when pricing rules change later.
 *
 * <p>Lifecycle: {@code DRAFT -> ISSUED -> PAID}. Drafts may be regenerated freely; issued or
 * paid invoices are final and any attempt to regenerate the same period is rejected.
 */
@Service
public class InvoiceService {

    private static final Logger log = LoggerFactory.getLogger(InvoiceService.class);

    /** Upper bound on the length of a billable period; guards against unbounded windows. */
    public static final long MAX_PERIOD_DAYS = 45;
    private static final String CURRENCY = "USD";
    private static final int MONEY_SCALE = 2;

    private final InvoiceRepository invoiceRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final UsageRecordRepository usageRecordRepository;
    private final PricingService pricingService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public InvoiceService(InvoiceRepository invoiceRepository,
                          SubscriptionRepository subscriptionRepository,
                          UsageRecordRepository usageRecordRepository,
                          PricingService pricingService,
                          ObjectMapper objectMapper,
                          Clock clock) {
        this.invoiceRepository = invoiceRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.usageRecordRepository = usageRecordRepository;
        this.pricingService = pricingService;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    /**
     * Generates (or regenerates, while still a draft) the invoice for one billing period.
     *
     * @param orgId       billing organisation identifier
     * @param periodStart inclusive start of the billed period (UTC)
     * @param periodEnd   exclusive end of the billed period (UTC)
     * @return the persisted invoice in {@code DRAFT} state
     * @throws IllegalArgumentException when the period is invalid (empty, reversed, longer than
     *                                  {@link #MAX_PERIOD_DAYS} days, or in the future)
     * @throws NoSuchElementException   when the organisation has no subscription
     * @throws IllegalStateException    when a non-draft invoice already exists for the period
     */
    @Transactional
    public InvoiceView generate(String orgId, Instant periodStart, Instant periodEnd) {
        validatePeriod(orgId, periodStart, periodEnd);
        Subscription subscription = subscriptionRepository.findByOrgId(orgId)
                .orElseThrow(() -> new NoSuchElementException("No subscription found for org " + orgId));

        invoiceRepository.findByOrgIdAndPeriodStart(orgId, periodStart)
                .filter(existing -> existing.getStatus() != InvoiceStatus.DRAFT)
                .ifPresent(existing -> {
                    throw new IllegalStateException("Invoice for org " + orgId + " period " + periodStart
                            + " already exists with status " + existing.getStatus()
                            + "; issued invoices cannot be regenerated");
                });

        Plan plan = subscription.getPlan();
        BigDecimal proration = pricingService.prorationFactor(periodStart, periodEnd);
        List<LineItem> lineItems = new ArrayList<>();

        BigDecimal baseAmount = plan.getMonthlyBasePrice().multiply(proration).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
        lineItems.add(new LineItem(LineItemKind.BASE_PLAN,
                plan.name() + " plan base subscription (proration factor " + plain(proration) + ")",
                BigDecimal.ONE, baseAmount, baseAmount));

        BigDecimal seatsAmount = BigDecimal.ZERO;
        int includedSeats = pricingService.includedSeats(plan);
        int billableSeats = Math.max(0, subscription.getSeats() - includedSeats);
        if (billableSeats > 0) {
            BigDecimal seatPrice = pricingService.seatPrice(plan);
            seatsAmount = seatPrice.multiply(BigDecimal.valueOf(billableSeats))
                    .multiply(proration).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
            lineItems.add(new LineItem(LineItemKind.ADDITIONAL_SEATS,
                    "Additional seats: " + billableSeats + " seat(s) at " + seatPrice + " " + CURRENCY
                            + "/seat/month beyond " + includedSeats + " included (proration factor " + plain(proration) + ")",
                    BigDecimal.valueOf(billableSeats), seatPrice, seatsAmount));
        }

        BigDecimal overage = BigDecimal.ZERO;
        for (MetricUsageTotal total : usageRecordRepository.sumUsageByMetric(orgId, periodStart, periodEnd)) {
            PricingService.MetricDescriptor descriptor = pricingService.descriptor(total.getMetricName());
            BigDecimal consumed = total.getTotal() == null ? BigDecimal.ZERO : total.getTotal();
            BigDecimal included = pricingService.includedQuantity(plan, descriptor.metricName());
            BigDecimal overageQuantity = consumed.subtract(included).max(BigDecimal.ZERO);
            BigDecimal overageUnits = pricingService.billableUnits(overageQuantity, descriptor.metricName());
            BigDecimal unitPrice = pricingService.overageUnitPrice(plan, descriptor.metricName());
            BigDecimal amount = overageUnits.multiply(unitPrice).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
            overage = overage.add(amount);
            lineItems.add(new LineItem(LineItemKind.USAGE_OVERAGE, usageDescription(descriptor, consumed, included,
                    overageQuantity, unitPrice), overageUnits, unitPrice, amount));
        }

        BigDecimal subtotal = baseAmount.add(seatsAmount);
        BigDecimal total = subtotal.add(overage);

        Invoice invoice = new Invoice();
        invoice.setOrgId(orgId);
        invoice.setPeriodStart(periodStart);
        invoice.setPeriodEnd(periodEnd);
        invoice.setSubtotal(subtotal);
        invoice.setOverage(overage);
        invoice.setTotal(total);
        invoice.setCurrency(CURRENCY);
        invoice.setStatus(InvoiceStatus.DRAFT);
        invoice.setLineItemsJson(serializeLineItems(lineItems));
        invoice.setCreatedAt(Instant.now(clock));

        // Regeneration replaces the draft. The delete is flushed explicitly so the insert of the
        // replacement cannot collide with the (org_id, period_start) unique constraint: Hibernate
        // orders inserts before deletes inside a flush.
        invoiceRepository.findByOrgIdAndPeriodStart(orgId, periodStart).ifPresent(existing -> {
            invoiceRepository.delete(existing);
            invoiceRepository.flush();
        });

        Invoice saved = invoiceRepository.save(invoice);
        log.info("Generated {} invoice for org {} period {}..{}: subtotal={}, overage={}, total={}",
                saved.getId(), orgId, periodStart, periodEnd, subtotal, overage, total);
        return toView(saved);
    }

    /**
     * Lists an organisation's invoices, newest billed period first.
     *
     * @param orgId billing organisation identifier
     * @return invoice views including their line items
     */
    @Transactional(readOnly = true)
    public List<InvoiceView> list(String orgId) {
        return invoiceRepository.findByOrgIdOrderByPeriodStartDesc(orgId).stream()
                .map(this::toView)
                .toList();
    }

    /**
     * Loads a single invoice.
     *
     * @param id invoice identifier
     * @return the invoice view
     * @throws NoSuchElementException when the invoice does not exist
     */
    @Transactional(readOnly = true)
    public InvoiceView get(UUID id) {
        return toView(requireInvoice(id));
    }

    /**
     * Issues a draft invoice: the document becomes immutable and payable.
     *
     * @param id invoice identifier
     * @return the updated invoice view
     * @throws NoSuchElementException  when the invoice does not exist
     * @throws IllegalStateException   when the invoice is not in {@code DRAFT} state
     */
    @Transactional
    public InvoiceView issue(UUID id) {
        Invoice invoice = requireInvoice(id);
        if (invoice.getStatus() != InvoiceStatus.DRAFT) {
            throw new IllegalStateException("Only DRAFT invoices can be issued; invoice " + id + " is " + invoice.getStatus());
        }
        invoice.setStatus(InvoiceStatus.ISSUED);
        invoice.setIssuedAt(Instant.now(clock));
        return toView(invoiceRepository.save(invoice));
    }

    /**
     * Marks an issued invoice as paid.
     *
     * @param id invoice identifier
     * @return the updated invoice view
     * @throws NoSuchElementException  when the invoice does not exist
     * @throws IllegalStateException   when the invoice is not in {@code ISSUED} state
     */
    @Transactional
    public InvoiceView markPaid(UUID id) {
        Invoice invoice = requireInvoice(id);
        if (invoice.getStatus() != InvoiceStatus.ISSUED) {
            throw new IllegalStateException("Only ISSUED invoices can be paid; invoice " + id + " is " + invoice.getStatus());
        }
        invoice.setStatus(InvoiceStatus.PAID);
        return toView(invoiceRepository.save(invoice));
    }

    private void validatePeriod(String orgId, Instant periodStart, Instant periodEnd) {
        if (orgId == null || orgId.isBlank()) {
            throw new IllegalArgumentException("orgId is required");
        }
        if (periodStart == null || periodEnd == null) {
            throw new IllegalArgumentException("periodStart and periodEnd are required");
        }
        if (!periodStart.isBefore(periodEnd)) {
            throw new IllegalArgumentException("periodStart must be before periodEnd");
        }
        if (Duration.between(periodStart, periodEnd).toDays() > MAX_PERIOD_DAYS) {
            throw new IllegalArgumentException("Billing period may not exceed " + MAX_PERIOD_DAYS + " days");
        }
        if (periodEnd.isAfter(Instant.now(clock).plus(Duration.ofDays(1)))) {
            throw new IllegalArgumentException("periodEnd must not be in the future");
        }
    }

    private String usageDescription(PricingService.MetricDescriptor descriptor, BigDecimal consumed,
                                    BigDecimal included, BigDecimal overageQuantity, BigDecimal unitPrice) {
        String pattern = "%s: %s %s consumed vs %s included - ";
        String prefix = String.format(Locale.ROOT, pattern,
                descriptor.metricName(),
                formatQuantity(consumed, descriptor.displayDecimals()),
                descriptor.unit(),
                formatQuantity(included, descriptor.displayDecimals()));
        if (overageQuantity.signum() == 0) {
            return prefix + "no overage";
        }
        return prefix + String.format(Locale.ROOT, "%s %s billable at %s %s per %s",
                formatQuantity(overageQuantity, descriptor.displayDecimals()),
                descriptor.unit(),
                unitPrice,
                CURRENCY,
                descriptor.billableUnitLabel());
    }

    private static String formatQuantity(BigDecimal value, int decimals) {
        return String.format(Locale.ROOT, "%,." + decimals + "f", value);
    }

    private static String plain(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString();
    }

    private Invoice requireInvoice(UUID id) {
        return invoiceRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Invoice not found: " + id));
    }

    private String serializeLineItems(List<LineItem> lineItems) {
        try {
            return objectMapper.writeValueAsString(lineItems);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not serialize invoice line items", ex);
        }
    }

    private InvoiceView toView(Invoice invoice) {
        return new InvoiceView(invoice.getId(), invoice.getOrgId(),
                invoice.getPeriodStart(), invoice.getPeriodEnd(),
                invoice.getCurrency(), invoice.getStatus().name(),
                invoice.getSubtotal(), invoice.getOverage(), invoice.getTotal(),
                invoice.getIssuedAt(), invoice.getCreatedAt(), deserializeLineItems(invoice.getLineItemsJson()));
    }

    private List<LineItemView> deserializeLineItems(String lineItemsJson) {
        try {
            CollectionType type = objectMapper.getTypeFactory()
                    .constructCollectionType(List.class, LineItem.class);
            List<LineItem> lineItems = objectMapper.readValue(lineItemsJson, type);
            return lineItems.stream()
                    .map(item -> new LineItemView(item.kind(), item.description(),
                            item.quantity(), item.unitPrice(), item.amount()))
                    .toList();
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Invoice line items could not be deserialized", ex);
        }
    }
}

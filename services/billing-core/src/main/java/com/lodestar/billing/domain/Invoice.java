package com.lodestar.billing.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

/**
 * An invoice for one billing period of one organisation.
 *
 * <p>Line items are stored as a JSON document ({@code line_items_json}) alongside the flattened
 * money columns ({@code subtotal}, {@code overage}, {@code total}). Storing the rendered document
 * keeps issued invoices immutable and auditable even if pricing rules evolve later; the JSON
 * schema is owned by {@code com.lodestar.billing.dto.LineItem}. The unique constraint on
 * {@code (org_id, period_start)} guarantees at most one invoice per organisation and period.
 */
@Entity
@Table(name = "invoices", uniqueConstraints = {
        @UniqueConstraint(name = "uk_invoice_org_period_start", columnNames = { "org_id", "period_start" })
})
public class Invoice {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false, length = 64)
    private String orgId;

    @Column(name = "period_start", nullable = false)
    private Instant periodStart;

    @Column(name = "period_end", nullable = false)
    private Instant periodEnd;

    @Column(name = "subtotal", nullable = false, precision = 19, scale = 4)
    private BigDecimal subtotal;

    @Column(name = "overage", nullable = false, precision = 19, scale = 4)
    private BigDecimal overage;

    @Column(name = "total", nullable = false, precision = 19, scale = 4)
    private BigDecimal total;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency = "USD";

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private InvoiceStatus status = InvoiceStatus.DRAFT;

    @Column(name = "line_items_json", nullable = false, length = 100000)
    private String lineItemsJson;

    @Column(name = "issued_at")
    private Instant issuedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Invoice() {
        // Required by JPA; use setters to construct in application code.
    }

    /** @return stable surrogate identifier used in the invoice API URLs. */
    public UUID getId() {
        return id;
    }

    /** @return billing organisation the invoice belongs to. */
    public String getOrgId() {
        return orgId;
    }

    public void setOrgId(String orgId) {
        this.orgId = orgId;
    }

    /** @return inclusive start of the billed period. */
    public Instant getPeriodStart() {
        return periodStart;
    }

    public void setPeriodStart(Instant periodStart) {
        this.periodStart = periodStart;
    }

    /** @return exclusive end of the billed period. */
    public Instant getPeriodEnd() {
        return periodEnd;
    }

    public void setPeriodEnd(Instant periodEnd) {
        this.periodEnd = periodEnd;
    }

    /** @return recurring charges (base plan plus additional seats). */
    public BigDecimal getSubtotal() {
        return subtotal;
    }

    public void setSubtotal(BigDecimal subtotal) {
        this.subtotal = subtotal;
    }

    /** @return metered usage charges above the plan's included allowances. */
    public BigDecimal getOverage() {
        return overage;
    }

    public void setOverage(BigDecimal overage) {
        this.overage = overage;
    }

    /** @return amount due, i.e. {@code subtotal + overage}. */
    public BigDecimal getTotal() {
        return total;
    }

    public void setTotal(BigDecimal total) {
        this.total = total;
    }

    /** @return ISO 4217 currency code; currently always {@code USD}. */
    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    /** @return lifecycle state of the invoice. */
    public InvoiceStatus getStatus() {
        return status;
    }

    public void setStatus(InvoiceStatus status) {
        this.status = status;
    }

    /** @return JSON document with the rendered line items (see {@code dto.LineItem}). */
    public String getLineItemsJson() {
        return lineItemsJson;
    }

    public void setLineItemsJson(String lineItemsJson) {
        this.lineItemsJson = lineItemsJson;
    }

    /** @return when the invoice left draft state, or {@code null} while still a draft. */
    public Instant getIssuedAt() {
        return issuedAt;
    }

    public void setIssuedAt(Instant issuedAt) {
        this.issuedAt = issuedAt;
    }

    /** @return when the invoice was first generated. */
    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}

package com.lodestar.billing.domain;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Repository for {@link Invoice} aggregates.
 */
public interface InvoiceRepository extends JpaRepository<Invoice, UUID> {

    /**
     * Lists an organisation's invoices, newest billed period first.
     *
     * @param orgId billing organisation identifier
     * @return invoices ordered by period start, descending
     */
    List<Invoice> findByOrgIdOrderByPeriodStartDesc(String orgId);

    /**
     * Finds the invoice generated for an exact period start. The unique constraint
     * {@code uk_invoice_org_period_start} guarantees at most one match.
     *
     * @param orgId       billing organisation identifier
     * @param periodStart inclusive start of the billed period
     * @return the invoice for the period, or empty when none was generated yet
     */
    Optional<Invoice> findByOrgIdAndPeriodStart(String orgId, Instant periodStart);
}

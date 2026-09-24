package com.lodestar.billing.web;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lodestar.billing.dto.InvoiceGenerateRequest;
import com.lodestar.billing.dto.InvoiceView;
import com.lodestar.billing.service.InvoiceService;

import jakarta.validation.Valid;

/**
 * Invoice API: generation from metered usage plus the {@code DRAFT -> ISSUED -> PAID} lifecycle.
 *
 * <p>Generation is idempotent per period: re-generating replaces the draft while issued or paid
 * invoices are immutable and rejected. State transitions are one-way and validated server-side;
 * there is no route that mutates a customer-facing document after issue.
 */
@RestController
@RequestMapping("/v1/invoices")
public class InvoiceController {

    private final InvoiceService invoiceService;

    public InvoiceController(InvoiceService invoiceService) {
        this.invoiceService = invoiceService;
    }

    /**
     * Generates (or re-generates, while still a draft) the invoice for one billing period.
     *
     * @param request organisation and half-open period bounds (UTC)
     * @return the persisted draft invoice with rendered line items
     */
    @PostMapping("/generate")
    @ResponseStatus(HttpStatus.CREATED)
    public InvoiceView generate(@Valid @RequestBody InvoiceGenerateRequest request) {
        return invoiceService.generate(request.orgId(), request.periodStart(), request.periodEnd());
    }

    /**
     * Lists an organisation's invoices, newest billed period first.
     *
     * @param orgId billing organisation identifier
     * @return invoice views including their line items
     */
    @GetMapping
    public List<InvoiceView> list(@RequestParam String orgId) {
        return invoiceService.list(orgId);
    }

    /**
     * Fetches a single invoice with its line items.
     *
     * @param id invoice identifier
     * @return the invoice view
     */
    @GetMapping("/{id}")
    public InvoiceView get(@PathVariable UUID id) {
        return invoiceService.get(id);
    }

    /**
     * Issues a draft invoice: the document becomes immutable and payable.
     *
     * @param id invoice identifier
     * @return the invoice in {@code ISSUED} state
     */
    @PostMapping("/{id}/issue")
    public InvoiceView issue(@PathVariable UUID id) {
        return invoiceService.issue(id);
    }

    /**
     * Marks an issued invoice as paid.
     *
     * @param id invoice identifier
     * @return the invoice in {@code PAID} state
     */
    @PostMapping("/{id}/pay")
    public InvoiceView pay(@PathVariable UUID id) {
        return invoiceService.markPaid(id);
    }
}

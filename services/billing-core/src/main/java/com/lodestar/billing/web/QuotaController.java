package com.lodestar.billing.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.lodestar.billing.dto.QuotaCheckRequest;
import com.lodestar.billing.dto.QuotaDecision;
import com.lodestar.billing.dto.QuotaStateView;
import com.lodestar.billing.dto.QuotaUpsertRequest;
import com.lodestar.billing.service.QuotaService;

import jakarta.validation.Valid;

/**
 * Quota API.
 *
 * <p>Quota checks are unauthenticated service-to-service calls (the ingest gateway evaluates
 * them on its forwarding path). Admin overrides require the {@code x-admin-key} header; in
 * production the platform gateway fronts this route with real operator authentication and
 * authorization, of which the shared key here is the local-development stand-in.
 */
@RestController
@RequestMapping("/v1/quotas")
public class QuotaController {

    private final QuotaService quotaService;
    private final String adminApiKey;

    public QuotaController(QuotaService quotaService,
                           @Value("${lodestar.billing.admin-api-key:change-me-admin-key}") String adminApiKey) {
        this.quotaService = quotaService;
        this.adminApiKey = adminApiKey;
    }

    /**
     * Evaluates whether {@code additional} units of a metric may be consumed. Allowed calls are
     * committed to the fast-path consumption counter; hard-limit calls are not.
     *
     * @param request the consumption probe
     * @return the quota decision with allowance, remaining head-room and reason
     */
    @PostMapping("/check")
    public QuotaDecision check(@Valid @RequestBody QuotaCheckRequest request) {
        return quotaService.enforceQuota(request.orgId(), request.metricName(), request.additional());
    }

    /**
     * Lists all configured quotas of an organisation.
     *
     * @param orgId billing organisation identifier
     * @return quota states ordered by metric name
     */
    @GetMapping
    public List<QuotaStateView> list(@RequestParam String orgId) {
        return quotaService.listForOrg(orgId);
    }

    /**
     * Creates or overrides the limits of one {@code (org, metric)} quota. Requires the
     * {@code x-admin-key} header.
     *
     * @param adminKey shared admin key from the {@code x-admin-key} header
     * @param request  the limit override; omitted limits keep their current value
     * @return the persisted quota state
     * @throws org.springframework.web.server.ResponseStatusException on a missing or invalid key
     */
    @PutMapping
    public QuotaStateView upsert(@RequestHeader(name = "x-admin-key", required = false) String adminKey,
                                 @Valid @RequestBody QuotaUpsertRequest request) {
        requireAdminKey(adminKey);
        return quotaService.upsert(request.orgId(), request.metricName(), request.softLimit(), request.hardLimit());
    }

    private void requireAdminKey(String providedKey) {
        byte[] provided = providedKey == null ? new byte[0] : providedKey.getBytes(StandardCharsets.UTF_8);
        byte[] expected = adminApiKey == null ? new byte[0] : adminApiKey.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(provided, expected)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "A valid x-admin-key header is required for admin quota operations");
        }
    }
}

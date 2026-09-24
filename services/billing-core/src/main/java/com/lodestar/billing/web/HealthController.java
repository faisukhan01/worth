package com.lodestar.billing.web;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.lodestar.billing.dto.HealthView;
import com.lodestar.billing.service.PricingService;

/**
 * Coarse health endpoint for load balancers and the platform dashboard.
 *
 * <p>Complements Spring Boot Actuator at {@code /actuator/health}: this route answers with a
 * stable, billing-specific payload (dependency checks plus service identity) that integration
 * tests and the web tier can consume without coupling to actuator's richer schema.
 */
@RestController
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final JdbcTemplate jdbcTemplate;
    private final PricingService pricingService;
    private final Clock clock;

    public HealthController(JdbcTemplate jdbcTemplate, PricingService pricingService, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.pricingService = pricingService;
        this.clock = clock;
    }

    /**
     * Reports service health. {@code status} is {@code ok} when every named check passes,
     * {@code degraded} otherwise; the HTTP status stays 200 either way so callers can inspect the
     * per-check detail instead of guessing from a bare failure code.
     *
     * @return named dependency checks with their pass/fail state
     */
    @GetMapping("/v1/health")
    public HealthView health() {
        Map<String, Boolean> checks = new LinkedHashMap<>();
        checks.put("database", isDatabaseUp());
        checks.put("pricingCatalog", !pricingService.knownMetrics().isEmpty());

        boolean healthy = checks.values().stream().allMatch(Boolean::booleanValue);
        if (!healthy) {
            log.warn("Health check degraded: {}", checks);
        }
        return new HealthView(healthy ? "ok" : "degraded", "billing-core", checks, Instant.now(clock));
    }

    private boolean isDatabaseUp() {
        try {
            Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            return one != null && one == 1;
        } catch (Exception ex) {
            log.error("Database health check failed", ex);
            return false;
        }
    }
}

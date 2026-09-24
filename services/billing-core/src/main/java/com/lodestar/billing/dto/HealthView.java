package com.lodestar.billing.dto;

import java.time.Instant;
import java.util.Map;

/**
 * Payload of {@code GET /v1/health}: coarse liveness/readiness signal complementing the richer
 * Spring Boot Actuator endpoint at {@code /actuator/health}.
 *
 * @param status    {@code ok} when every check passes, otherwise {@code degraded}
 * @param service   service identifier, always {@code billing-core}
 * @param checks    named dependency checks and their pass/fail state
 * @param checkedAt UTC instant at which the checks ran
 */
public record HealthView(String status, String service, Map<String, Boolean> checks, Instant checkedAt) {
}

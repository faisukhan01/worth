package com.lodestar.billing.web;

import java.util.Arrays;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import com.lodestar.billing.domain.Plan;
import com.lodestar.billing.dto.PlanView;

/**
 * Public catalog of commercial plans. Read-only: the catalog is code-defined on the
 * {@link Plan} enum so the API always reflects what the pricing engine will actually charge.
 */
@RestController
public class PlanController {

    /**
     * Lists every plan in the catalog, ordered from entry tier to enterprise tier.
     *
     * @return all plans with their allowances and overage prices
     */
    @GetMapping("/v1/plans")
    public List<PlanView> list() {
        return Arrays.stream(Plan.values()).map(PlanController::toView).toList();
    }

    /**
     * Fetches a single plan by name (case-insensitive).
     *
     * @param name plan name, e.g. {@code PRO}
     * @return the plan catalog entry
     * @throws java.util.NoSuchElementException when no plan with that name exists (HTTP 404)
     */
    @GetMapping("/v1/plans/{name}")
    public PlanView get(@PathVariable String name) {
        return Arrays.stream(Plan.values())
                .filter(plan -> plan.name().equalsIgnoreCase(name))
                .findFirst()
                .map(PlanController::toView)
                .orElseThrow(() -> new java.util.NoSuchElementException("Unknown plan: " + name));
    }

    private static PlanView toView(Plan plan) {
        return new PlanView(plan.name(), plan.getMonthlyBasePrice(), plan.getIncludedEventsPerMonth(),
                plan.getIncludedHosts(), plan.getPerMillionOverage());
    }
}

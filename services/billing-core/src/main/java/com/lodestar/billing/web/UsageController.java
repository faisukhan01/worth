package com.lodestar.billing.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.lodestar.billing.dto.BatchUsageRequest;
import com.lodestar.billing.dto.BatchUsageResponse;
import com.lodestar.billing.dto.UsageGranularity;
import com.lodestar.billing.dto.UsageSummary;
import com.lodestar.billing.service.MeteringService;

import jakarta.validation.Valid;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/**
 * Usage metering API: batch ingestion and consumption reporting.
 */
@RestController
@RequestMapping("/v1/usage")
public class UsageController {

    private final MeteringService meteringService;

    public UsageController(MeteringService meteringService) {
        this.meteringService = meteringService;
    }

    /**
     * Ingests a batch of metered usage events. Processing is idempotent per external event id;
     * invalid or quota-blocked events are rejected individually without failing the batch.
     *
     * @param request batch of usage events (max 1000)
     * @return per-category outcome counters plus per-event error detail
     */
    @PostMapping("/batch")
    public BatchUsageResponse ingestBatch(@Valid @RequestBody BatchUsageRequest request) {
        return meteringService.ingestBatch(request);
    }

    /**
     * Reports consumption over the currently open billing period of an organisation.
     *
     * @param orgId billing organisation identifier
     * @return per-metric totals and a daily time series for the open period
     */
    @GetMapping("/current")
    public UsageSummary current(@RequestParam String orgId) {
        return meteringService.currentPeriodUsage(orgId);
    }

    /**
     * Reports consumption over an explicit window. Without {@code period} the currently open
     * billing period is reported; with {@code period} (format {@code yyyy-MM}) the UTC calendar
     * month is reported instead.
     *
     * @param orgId       billing organisation identifier
     * @param period      optional calendar month, e.g. {@code 2025-11}
     * @param granularity time-series bucket size, {@code day} (default) or {@code hour}
     * @return per-metric totals and the bucketed time series
     * @throws IllegalArgumentException when {@code period} or {@code granularity} is malformed
     */
    @GetMapping("/summary")
    public UsageSummary summary(@RequestParam String orgId,
                                @RequestParam(required = false) String period,
                                @RequestParam(defaultValue = "day") String granularity) {
        YearMonth month = parsePeriod(period);
        UsageGranularity bucketSize = parseGranularity(granularity);
        return meteringService.usageSummary(orgId, month, bucketSize);
    }

    private static YearMonth parsePeriod(String period) {
        if (period == null || period.isBlank()) {
            return null;
        }
        try {
            return YearMonth.parse(period.trim());
        } catch (DateTimeParseException ex) {
            throw new IllegalArgumentException("period must use yyyy-MM format, e.g. 2025-11");
        }
    }

    private static UsageGranularity parseGranularity(String granularity) {
        try {
            return UsageGranularity.valueOf(granularity.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("granularity must be one of: hour, day");
        }
    }
}

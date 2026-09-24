using Lodestar.Reporting.Models;

namespace Lodestar.Reporting.Services;

/// <summary>
/// Reference implementation of the availability and error-budget math.
///
/// <para>
/// Formulas (window length W minutes, SLO target s as a fraction of good outcomes, F failed and
/// N total requests):
/// <list type="bullet">
///   <item>availability = (1 - F/N) * 100 (percent), defined as 100 when N = 0.</item>
///   <item>downtime minutes = W * F/N.</item>
///   <item>error budget minutes = W * (1 - s) - the downtime a perfectly-at-SLO window may spend.</item>
///   <item>budget remaining % = clamp((budget - downtime) / budget, 0, 1) * 100.</item>
///   <item>burn rate = (F/N) / (1 - s) per Google SRE: 1.0 consumes the budget exactly within
///   one window length; the multiwindow alerting thresholds of 14.4 ("fast", ~2 days to exhaust
///   a 30-day budget) and 6.0 ("slow", ~5 days) classify incident severity.</item>
/// </list>
/// </para>
/// </summary>
public sealed class SlaCalculator : ISlaCalculator
{
    /// <summary>Hourly error rate at or above which an hour counts as incident traffic (2%).</summary>
    public const double IncidentErrorRateThreshold = 0.02;

    /// <summary>Google SRE "fast burn" page threshold (2% of a 30-day budget in one hour).</summary>
    public const double FastBurnThreshold = 14.4;

    /// <summary>Google SRE "slow burn" page threshold (5% of a 30-day budget in six hours).</summary>
    public const double SlowBurnThreshold = 6.0;

    /// <inheritdoc />
    public AvailabilitySummary ComputeAvailability(
        IReadOnlyList<TelemetrySample> samples,
        DateTimeOffset windowStart,
        DateTimeOffset windowEnd,
        double sloPercent)
    {
        long totalRequests = 0;
        long failedRequests = 0;
        foreach (TelemetrySample sample in samples)
        {
            totalRequests += sample.Requests;
            failedRequests += sample.Errors;
        }

        double windowMinutes = (windowEnd - windowStart).TotalMinutes;
        double failureFraction = totalRequests == 0 ? 0.0 : (double)failedRequests / totalRequests;
        double sloFailureAllowance = 1.0 - sloPercent / 100.0;

        double downtimeMinutes = Round2(windowMinutes * failureFraction);
        double errorBudgetMinutes = Round2(windowMinutes * sloFailureAllowance);
        double remainingMinutes = Math.Max(0.0, errorBudgetMinutes - downtimeMinutes);
        double errorBudgetPctRemaining = errorBudgetMinutes <= 0.0
            ? 0.0
            : Round2(remainingMinutes / errorBudgetMinutes * 100.0);
        double burnRate = sloFailureAllowance <= 0.0
            ? 0.0
            : Round3(failureFraction / sloFailureAllowance);

        return new AvailabilitySummary(
            Round3((1.0 - failureFraction) * 100.0),
            downtimeMinutes,
            totalRequests,
            failedRequests,
            errorBudgetMinutes,
            errorBudgetPctRemaining,
            burnRate);
    }

    /// <inheritdoc />
    public IReadOnlyList<DailyAvailabilityRow> ComputeDailyRows(IReadOnlyList<TelemetrySample> samples)
    {
        return samples
            .GroupBy(sample => DateOnly.FromDateTime(sample.Hour.UtcDateTime))
            .OrderBy(group => group.Key)
            .Select(group =>
            {
                long requests = group.Sum(sample => sample.Requests);
                long errors = group.Sum(sample => sample.Errors);
                double uptimePct = requests == 0
                    ? 100.0
                    : Round3((1.0 - (double)errors / requests) * 100.0);
                return new DailyAvailabilityRow(group.Key, uptimePct, requests, errors);
            })
            .ToList();
    }

    /// <inheritdoc />
    public IReadOnlyList<IncidentSummaryReport> DetectIncidents(IReadOnlyList<TelemetrySample> samples, double sloPercent)
    {
        double sloFailureAllowance = 1.0 - sloPercent / 100.0;
        var incidents = new List<IncidentSummaryReport>();

        DateTimeOffset? runStart = null;
        DateTimeOffset runEnd = default;
        long runFailed = 0;
        double peakBurnRate = 0.0;

        foreach (TelemetrySample sample in samples.OrderBy(sample => sample.Hour))
        {
            double errorRate = sample.Requests == 0 ? 0.0 : (double)sample.Errors / sample.Requests;
            bool isIncidentHour = errorRate >= IncidentErrorRateThreshold && sample.Requests > 0;

            if (!isIncidentHour)
            {
                if (runStart.HasValue)
                {
                    incidents.Add(BuildIncident(runStart.Value, runEnd, runFailed, peakBurnRate));
                    runStart = null;
                    runFailed = 0;
                    peakBurnRate = 0.0;
                }

                continue;
            }

            runStart ??= sample.Hour;
            runEnd = sample.Hour.AddHours(1);
            runFailed += sample.Errors;
            peakBurnRate = Math.Max(peakBurnRate, CalculateBurnRate(errorRate, sloFailureAllowance));
        }

        if (runStart.HasValue)
        {
            incidents.Add(BuildIncident(runStart.Value, runEnd, runFailed, peakBurnRate));
        }

        return incidents;
    }

    private static IncidentSummaryReport BuildIncident(
        DateTimeOffset startedAt,
        DateTimeOffset endedAt,
        long failedRequests,
        double peakBurnRate)
    {
        string severity = peakBurnRate >= FastBurnThreshold
            ? "critical"
            : peakBurnRate >= SlowBurnThreshold ? "major" : "minor";

        return new IncidentSummaryReport(
            startedAt,
            endedAt,
            Math.Round((endedAt - startedAt).TotalMinutes, 1),
            failedRequests,
            severity);
    }

    private static double CalculateBurnRate(double errorRate, double sloFailureAllowance)
    {
        return sloFailureAllowance <= 0.0 ? 0.0 : errorRate / sloFailureAllowance;
    }

    private static double Round2(double value)
    {
        return Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    private static double Round3(double value)
    {
        return Math.Round(value, 3, MidpointRounding.AwayFromZero);
    }
}

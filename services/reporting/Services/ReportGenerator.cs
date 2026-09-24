using Lodestar.Reporting.Models;

using Microsoft.Extensions.Options;

namespace Lodestar.Reporting.Services;

/// <summary>
/// Orchestrates SLA report generation: telemetry in, availability math, daily rollups and
/// incident detection out. Stateless by design - persistence of the produced report is the
/// caller's concern, which keeps generation usable without the file store (e.g. previews).
/// </summary>
public sealed class ReportGenerator
{
    /// <summary>
    /// Maximum span a single report may cover, in days. Aligned with the default retention
    /// window so no generated report can be expired by the very next retention sweep.
    /// </summary>
    public const int MaxWindowDays = 90;

    private readonly ITelemetrySource telemetrySource;
    private readonly ISlaCalculator slaCalculator;
    private readonly ReportingOptions options;

    /// <summary>Creates the generator.</summary>
    /// <param name="telemetrySource">Telemetry adapter for the window's samples.</param>
    /// <param name="slaCalculator">Availability math.</param>
    /// <param name="options">Reporting options (provides the default SLO target).</param>
    public ReportGenerator(ITelemetrySource telemetrySource, ISlaCalculator slaCalculator, IOptions<ReportingOptions> options)
    {
        this.telemetrySource = telemetrySource;
        this.slaCalculator = slaCalculator;
        this.options = options.Value;
    }

    /// <summary>
    /// Generates an SLA report for one service over a half-open window.
    /// </summary>
    /// <param name="serviceId">Service to report on.</param>
    /// <param name="fromUtc">Inclusive window start (UTC).</param>
    /// <param name="toUtc">Exclusive window end (UTC).</param>
    /// <param name="sloPercent">
    /// SLO target in percent; <c>null</c> applies <c>Reporting:DefaultSlo</c> (99.9).
    /// </param>
    /// <returns>The assembled report with a fresh identifier.</returns>
    public SlaReport Generate(string serviceId, DateTimeOffset fromUtc, DateTimeOffset toUtc, double? sloPercent)
    {
        double sloTarget = sloPercent ?? options.DefaultSlo;
        IReadOnlyList<TelemetrySample> samples = telemetrySource.LoadHourlySamples(serviceId, fromUtc, toUtc);

        AvailabilitySummary summary = slaCalculator.ComputeAvailability(samples, fromUtc, toUtc, sloTarget);
        IReadOnlyList<DailyAvailabilityRow> daily = slaCalculator.ComputeDailyRows(samples);
        IReadOnlyList<IncidentSummaryReport> incidents = slaCalculator.DetectIncidents(samples, sloTarget);

        return new SlaReport(
            Guid.NewGuid(),
            serviceId,
            fromUtc,
            toUtc,
            sloTarget,
            summary,
            daily,
            incidents,
            DateTimeOffset.UtcNow);
    }
}

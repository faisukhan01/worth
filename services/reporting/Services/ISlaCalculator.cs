using Lodestar.Reporting.Models;

namespace Lodestar.Reporting.Services;

/// <summary>
/// Pure SLO/SLA math over hourly telemetry samples. Implementations must be side-effect free so
/// report generation is reproducible and trivially testable.
/// </summary>
public interface ISlaCalculator
{
    /// <summary>
    /// Computes the window-level availability summary over the half-open window
    /// [<paramref name="windowStart"/>, <paramref name="windowEnd"/>) using the samples inside it.
    /// </summary>
    /// <param name="samples">Hourly samples inside the window.</param>
    /// <param name="windowStart">Inclusive window start (UTC).</param>
    /// <param name="windowEnd">Exclusive window end (UTC).</param>
    /// <param name="sloPercent">SLO target in percent, strictly between 0 and 100.</param>
    /// <returns>The availability and error-budget summary for the window.</returns>
    AvailabilitySummary ComputeAvailability(
        IReadOnlyList<TelemetrySample> samples,
        DateTimeOffset windowStart,
        DateTimeOffset windowEnd,
        double sloPercent);

    /// <summary>Rolls hourly samples up into one availability row per UTC day, oldest first.</summary>
    /// <param name="samples">Hourly samples inside the reported window.</param>
    /// <returns>One row per day that carries samples, ordered by date.</returns>
    IReadOnlyList<DailyAvailabilityRow> ComputeDailyRows(IReadOnlyList<TelemetrySample> samples);

    /// <summary>
    /// Detects incidents: maximal runs of consecutive hours whose error rate reaches the
    /// incident threshold, with severity classified by peak hourly burn rate.
    /// </summary>
    /// <param name="samples">Hourly samples inside the reported window.</param>
    /// <param name="sloPercent">SLO target in percent used for burn-rate classification.</param>
    /// <returns>The detected incidents, oldest first.</returns>
    IReadOnlyList<IncidentSummaryReport> DetectIncidents(IReadOnlyList<TelemetrySample> samples, double sloPercent);
}

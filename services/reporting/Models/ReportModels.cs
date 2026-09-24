namespace Lodestar.Reporting.Models;

/// <summary>
/// Request body of <c>POST /v1/reports/sla</c>.
/// </summary>
/// <param name="ServiceId">
/// Service to report on, e.g. <c>ingest-gateway</c>. Must match the identifier the gateway uses.
/// </param>
/// <param name="From">Inclusive start of the evaluated window (UTC).</param>
/// <param name="To">Exclusive end of the evaluated window (UTC). At most 90 days after From.</param>
/// <param name="SloTarget">
/// Optional SLO target in percent, e.g. 99.95. When omitted the service default
/// (<c>Reporting:DefaultSlo</c>, 99.9) applies.
/// </param>
public sealed record SlaReportRequest(
    string ServiceId,
    DateTimeOffset From,
    DateTimeOffset To,
    double? SloTarget = null);

/// <summary>
/// A persisted SLA report: window, SLO target, availability summary, daily rollups and the
/// incidents detected inside the window.
/// </summary>
/// <param name="Id">Stable identifier used in report URLs.</param>
/// <param name="ServiceId">Service the report was generated for.</param>
/// <param name="From">Inclusive start of the evaluated window (UTC).</param>
/// <param name="To">Exclusive end of the evaluated window (UTC).</param>
/// <param name="SloTarget">SLO target in percent the report was evaluated against.</param>
/// <param name="Summary">Window-level availability and error-budget figures.</param>
/// <param name="Daily">One rollup row per UTC day in the window, oldest first.</param>
/// <param name="Incidents">Outage/error-rate episodes detected inside the window, oldest first.</param>
/// <param name="GeneratedAt">UTC instant at which the report was computed.</param>
public sealed record SlaReport(
    Guid Id,
    string ServiceId,
    DateTimeOffset From,
    DateTimeOffset To,
    double SloTarget,
    AvailabilitySummary Summary,
    IReadOnlyList<DailyAvailabilityRow> Daily,
    IReadOnlyList<IncidentSummaryReport> Incidents,
    DateTimeOffset GeneratedAt);

/// <summary>
/// Window-level availability figures.
/// All duration figures are minutes so the summary can be rendered without unit conversion.
/// </summary>
/// <param name="AvailabilityPct">
/// Successful requests as a percent of total requests: (1 - failed/total) * 100; 100 when the
/// window carries no traffic.
/// </param>
/// <param name="TotalDowntime">Window minutes attributed as downtime: windowMinutes * (failed/total).</param>
/// <param name="TotalRequests">Total requests observed in the window.</param>
/// <param name="FailedRequests">Failed requests observed in the window.</param>
/// <param name="ErrorBudgetMinutes">
/// Allowed downtime in minutes: (1 - slo) * windowMinutes, where slo is the target as a fraction.
/// </param>
/// <param name="ErrorBudgetPctRemaining">
/// Share of the error budget left: max(0, budget - downtime) / budget * 100; 0 when the budget
/// is exhausted or zero.
/// </param>
/// <param name="BurnRate">
/// Speed of error-budget consumption: (failed/total) / (1 - slo). 1.0 means the budget is being
/// consumed at exactly the rate that would exhaust it in one window length; 14.4 would exhaust a
/// 30-day budget in about 2 days.
/// </param>
public sealed record AvailabilitySummary(
    double AvailabilityPct,
    double TotalDowntime,
    long TotalRequests,
    long FailedRequests,
    double ErrorBudgetMinutes,
    double ErrorBudgetPctRemaining,
    double BurnRate);

/// <summary>Per-UTC-day availability rollup.</summary>
/// <param name="Date">UTC calendar day.</param>
/// <param name="UptimePct">Successful requests as a percent of the day's requests; 100 with no traffic.</param>
/// <param name="Requests">Requests served during the day.</param>
/// <param name="Errors">Failed requests during the day.</param>
public sealed record DailyAvailabilityRow(
    DateOnly Date,
    double UptimePct,
    long Requests,
    long Errors);

/// <summary>
/// One incident episode: a maximal run of consecutive hours whose error rate reached the
/// incident threshold (2% of hourly traffic).
/// </summary>
/// <param name="StartedAt">UTC start of the first elevated-error hour.</param>
/// <param name="EndedAt">UTC end of the last elevated-error hour (exclusive).</param>
/// <param name="DurationMinutes">EndedAt - StartedAt, in minutes.</param>
/// <param name="EstimatedFailedRequests">Sum of failed requests across the incident hours.</param>
/// <param name="Severity">
/// Classified by the peak hourly burn rate during the incident, following Google SRE alerting
/// conventions: <c>critical</c> at 14.4 or above, <c>major</c> at 6 or above, <c>minor</c> below.
/// </param>
public sealed record IncidentSummaryReport(
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    double DurationMinutes,
    long EstimatedFailedRequests,
    string Severity);

/// <summary>Export formats supported by <c>GET /v1/reports/sla/{id}/export</c>.</summary>
public enum ReportFormat
{
    /// <summary>RFC 4180 CSV document (summary, daily and incident sections).</summary>
    Csv,

    /// <summary>The full JSON report document.</summary>
    Json
}

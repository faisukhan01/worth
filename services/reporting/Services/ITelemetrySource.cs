namespace Lodestar.Reporting.Services;

/// <summary>
/// One hour of service telemetry feeding SLA computation.
/// </summary>
/// <param name="Hour">UTC start of the hour bucket.</param>
/// <param name="Requests">Total requests served during the hour.</param>
/// <param name="Errors">Failed requests (5xx-equivalent) during the hour.</param>
/// <param name="P95LatencyMs">95th percentile response latency in milliseconds.</param>
public sealed record TelemetrySample(DateTimeOffset Hour, long Requests, long Errors, double P95LatencyMs);

/// <summary>
/// Source of per-service hourly telemetry. Abstracted so the report pipeline can run against
/// synthetic data in development and the real telemetry spine in production without changes.
/// </summary>
public interface ITelemetrySource
{
    /// <summary>
    /// Loads hourly samples for <paramref name="serviceId"/> over the half-open window
    /// [<paramref name="fromUtc"/>, <paramref name="toUtc"/>), oldest first.
    /// </summary>
    /// <param name="serviceId">Service to load samples for.</param>
    /// <param name="fromUtc">Inclusive window start (UTC).</param>
    /// <param name="toUtc">Exclusive window end (UTC).</param>
    /// <returns>The samples inside the window; empty when the window is empty.</returns>
    IReadOnlyList<TelemetrySample> LoadHourlySamples(string serviceId, DateTimeOffset fromUtc, DateTimeOffset toUtc);
}

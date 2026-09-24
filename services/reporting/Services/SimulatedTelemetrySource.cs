namespace Lodestar.Reporting.Services;

/// <summary>
/// Deterministic synthetic telemetry source used in development and for demos.
///
/// <para>
/// PRODUCTION NOTE: this adapter is a development stand-in. Production binds to the Lodestar Go
/// ingest gateway on port 3100, pulling per-service request/error/latency counters from
/// <c>GET /v1/query/metrics</c> (see the monorepo worklog API contracts) and folding them into
/// the same <see cref="TelemetrySample"/> shape; nothing downstream changes.
/// </para>
///
/// <para>
/// Output is a pure function of (serviceId, absolute hour): traffic follows a diurnal curve,
/// drops on weekends, and carries pseudo-random noise, so the same window always yields the
/// same samples. Roughly one incident (a run of 1-3 hours at ~6% errors and elevated latency)
/// occurs per 72-hour epoch per service, so reports exercise the incident-detection path.
/// Determinism relies on the runtime's seeded <see cref="Random(int)"/> stream, which is stable
/// within a .NET major version.
/// </para>
/// </summary>
public sealed class SimulatedTelemetrySource : ITelemetrySource
{
    private const long BaseHourlyRequests = 45_000;
    private const double BaseErrorRate = 0.003;
    private const double BaseP95LatencyMs = 120.0;
    private const double IncidentErrorRate = 0.06;
    private const long EpochHours = 72;
    private const int IncidentMaxHours = 3;

    /// <inheritdoc />
    public IReadOnlyList<TelemetrySample> LoadHourlySamples(string serviceId, DateTimeOffset fromUtc, DateTimeOffset toUtc)
    {
        var samples = new List<TelemetrySample>();
        if (string.IsNullOrWhiteSpace(serviceId) || toUtc <= fromUtc)
        {
            return samples;
        }

        int seed = Fnv1a(serviceId.Trim());
        long startHour = FloorHourIndex(fromUtc);
        long endHour = FloorHourIndex(toUtc);

        for (long hourIndex = startHour; hourIndex < endHour; hourIndex++)
        {
            var hour = DateTimeOffset.FromUnixTimeSeconds(hourIndex * 3600);
            var random = new Random(unchecked(seed ^ (int)hourIndex));
            samples.Add(SampleFor(hour, hourIndex, seed, random));
        }

        return samples;
    }

    private static TelemetrySample SampleFor(DateTimeOffset hour, long hourIndex, int seed, Random random)
    {
        var utc = hour.UtcDateTime;
        double diurnal = 1.0 + 0.35 * Math.Sin(2 * Math.PI * (utc.Hour - 9) / 24.0);
        bool weekend = utc.DayOfWeek == DayOfWeek.Saturday || utc.DayOfWeek == DayOfWeek.Sunday;
        double weekendFactor = weekend ? 0.6 : 1.0;
        double noise = 0.85 + 0.3 * random.NextDouble();
        double loadFactor = diurnal * weekendFactor * noise;

        long requests = (long)Math.Max(0, BaseHourlyRequests * loadFactor);

        bool incident = IsIncidentHour(hourIndex, seed);
        double errorRate = incident
            ? IncidentErrorRate * (0.7 + 0.6 * random.NextDouble())
            : BaseErrorRate * (0.5 + random.NextDouble());
        long errors = (long)Math.Round(requests * errorRate);

        double latency = BaseP95LatencyMs * loadFactor * (incident ? 2.5 : 1.0) + random.Next(0, 40);

        return new TelemetrySample(hour, requests, errors, Math.Round(latency, 1));
    }

    /// <summary>
    /// Incident schedule: each 72-hour epoch contains one incident of 1-3 hours at a
    /// pseudo-random offset, derived deterministically from (service seed, epoch).
    /// </summary>
    private static bool IsIncidentHour(long hourIndex, int seed)
    {
        long epoch = Math.DivRem(hourIndex, EpochHours, out long offset);
        var epochRandom = new Random(unchecked(seed ^ (int)(epoch * 2654435761)));
        long start = epochRandom.Next(8, (int)EpochHours - IncidentMaxHours - 8);
        long duration = epochRandom.Next(1, IncidentMaxHours + 1);
        return offset >= start && offset < start + duration;
    }

    private static long FloorHourIndex(DateTimeOffset timestamp)
    {
        return timestamp.ToUnixTimeSeconds() / 3600;
    }

    private static int Fnv1a(string text)
    {
        unchecked
        {
            uint hash = 2166136261;
            foreach (char c in text)
            {
                hash ^= c;
                hash *= 16777619;
            }

            return (int)hash;
        }
    }
}

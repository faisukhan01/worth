using Lodestar.Reporting.Models;

namespace Lodestar.Reporting.Services;

/// <summary>
/// Durable store for generated reports. Implementations own persistence concerns (format,
/// location, thread safety, retention); callers work purely with <see cref="SlaReport"/> values.
/// </summary>
public interface IReportStore
{
    /// <summary>Persists a report, replacing any existing report with the same identifier.</summary>
    /// <param name="report">The report to persist.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task SaveAsync(SlaReport report, CancellationToken cancellationToken = default);

    /// <summary>Loads a report by identifier.</summary>
    /// <param name="id">Report identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The report, or <c>null</c> when no report with that identifier exists.</returns>
    Task<SlaReport?> GetAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Lists reports, newest first.</summary>
    /// <param name="serviceId">
    /// When non-null, only reports for this service (case-insensitive) are returned.
    /// </param>
    /// <param name="limit">Maximum number of reports to return.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>At most <paramref name="limit"/> reports ordered by generation time, descending.</returns>
    Task<IReadOnlyList<SlaReport>> ListAsync(string? serviceId, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes reports older than the retention window. Called by the retention worker;
    /// corrupt or unreadable files past the cutoff are deleted as well (retention is final).
    /// </summary>
    /// <param name="nowUtc">Current UTC time.</param>
    /// <param name="retentionDays">Age in days beyond which reports are deleted.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Number of files removed.</returns>
    Task<int> DeleteExpiredAsync(DateTimeOffset nowUtc, int retentionDays, CancellationToken cancellationToken = default);
}

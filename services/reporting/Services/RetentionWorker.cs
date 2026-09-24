using Lodestar.Reporting.Models;

using Microsoft.Extensions.Options;

namespace Lodestar.Reporting.Services;

/// <summary>
/// Background retention sweep: deletes report files older than <c>Reporting:RetentionDays</c>
/// at startup and then every six hours.
///
/// <para>
/// Retention is housekeeping, not a correctness dependency: a failed sweep is logged and retried
/// on the next tick rather than crashing the host, and cancellation is honoured promptly on
/// shutdown.
/// </para>
/// </summary>
public sealed class RetentionWorker : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromHours(6);

    private readonly IReportStore store;
    private readonly ReportingOptions options;
    private readonly ILogger<RetentionWorker> logger;

    /// <summary>Creates the worker.</summary>
    /// <param name="store">Report store to sweep.</param>
    /// <param name="options">Reporting options (retention window).</param>
    /// <param name="logger">Logger.</param>
    public RetentionWorker(IReportStore store, IOptions<ReportingOptions> options, ILogger<RetentionWorker> logger)
    {
        this.store = store;
        this.options = options.Value;
        this.logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var timer = new PeriodicTimer(SweepInterval);
            do
            {
                await SweepAsync(stoppingToken).ConfigureAwait(false);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
        }
        catch (OperationCanceledException)
        {
            // Expected on host shutdown; BackgroundService handles the stop logging.
        }
    }

    private async Task SweepAsync(CancellationToken cancellationToken)
    {
        try
        {
            int removed = await store
                .DeleteExpiredAsync(DateTimeOffset.UtcNow, options.RetentionDays, cancellationToken)
                .ConfigureAwait(false);
            if (removed > 0)
            {
                logger.LogInformation(
                    "Retention sweep removed {Count} report(s) older than {Days} days",
                    removed,
                    options.RetentionDays);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Shutdown raced the sweep; the next sweep after restart will finish the job.
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Retention sweep failed; retrying at the next interval");
        }
    }
}

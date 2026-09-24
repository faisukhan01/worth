using System.Text.Json;
using System.Text.Json.Serialization;

using Lodestar.Reporting.Models;

using Microsoft.Extensions.Options;

namespace Lodestar.Reporting.Services;

/// <summary>
/// JSON-file backed report store rooted at <c>{Reporting:DataDir}/reports</c>, one file per
/// report named by its identifier.
///
/// <para>
/// All file access is serialized through a <see cref="SemaphoreSlim"/>: concurrent generations
/// and exports are safe without external locking, and saves write to a temporary file followed
/// by an atomic move so a crash can never leave a half-written report behind. This store targets
/// the single-node deployment profile of the sandbox; a production multi-node deployment would
/// swap in an object-storage or database implementation behind the same interface.
/// </para>
/// </summary>
public sealed class FileReportStore : IReportStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };

    private readonly string reportsDirectory;
    private readonly ILogger<FileReportStore> logger;
    private readonly SemaphoreSlim gate = new(1, 1);

    /// <summary>Creates the store and ensures the reports directory exists.</summary>
    /// <param name="options">Reporting options supplying the data directory.</param>
    /// <param name="logger">Logger.</param>
    public FileReportStore(IOptions<ReportingOptions> options, ILogger<FileReportStore> logger)
    {
        reportsDirectory = Path.Combine(options.Value.DataDir, "reports");
        this.logger = logger;
        Directory.CreateDirectory(reportsDirectory);
    }

    /// <inheritdoc />
    public async Task SaveAsync(SlaReport report, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            string path = PathFor(report.Id);
            string tempPath = path + ".tmp";
            await using (var stream = File.Create(tempPath))
            {
                await JsonSerializer
                    .SerializeAsync(stream, report, SerializerOptions, cancellationToken)
                    .ConfigureAwait(false);
            }

            File.Move(tempPath, path, overwrite: true);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<SlaReport?> GetAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await ReadAsync(PathFor(id), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SlaReport>> ListAsync(
        string? serviceId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var reports = new List<SlaReport>();
            foreach (string path in Directory.EnumerateFiles(reportsDirectory, "*.json"))
            {
                SlaReport? report = await ReadAsync(path, cancellationToken).ConfigureAwait(false);
                if (report is null)
                {
                    continue;
                }

                if (serviceId is null
                    || string.Equals(report.ServiceId, serviceId, StringComparison.OrdinalIgnoreCase))
                {
                    reports.Add(report);
                }
            }

            return reports
                .OrderByDescending(report => report.GeneratedAt)
                .Take(limit)
                .ToList();
        }
        finally
        {
            gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<int> DeleteExpiredAsync(
        DateTimeOffset nowUtc,
        int retentionDays,
        CancellationToken cancellationToken = default)
    {
        DateTime cutoffUtc = nowUtc.AddDays(-retentionDays).UtcDateTime;
        int removed = 0;

        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (string path in Directory.EnumerateFiles(reportsDirectory, "*.json"))
            {
                var info = new FileInfo(path);
                if (info.LastWriteTimeUtc >= cutoffUtc)
                {
                    continue;
                }

                File.Delete(path);
                removed++;
            }
        }
        finally
        {
            gate.Release();
        }

        return removed;
    }

    private string PathFor(Guid id)
    {
        return Path.Combine(reportsDirectory, id.ToString("D") + ".json");
    }

    private async Task<SlaReport?> ReadAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer
                .DeserializeAsync<SlaReport>(stream, SerializerOptions, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Skipping unreadable report file {Path}", path);
            return null;
        }
    }
}

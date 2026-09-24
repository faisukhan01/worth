using System.Globalization;
using System.Text;

using Lodestar.Reporting.Models;

namespace Lodestar.Reporting.Services;

/// <summary>
/// Minimal RFC 4180 CSV writer.
///
/// <para>
/// Escaping rules (RFC 4180 section 2): fields containing a comma, double quote, CR or LF are
/// wrapped in double quotes and embedded double quotes are doubled; all other fields are emitted
/// verbatim. Records use CRLF line endings and numeric values are rendered with
/// <see cref="CultureInfo.InvariantCulture"/> so exports parse identically in every locale.
/// </para>
///
/// <para>
/// An SLA report is exported as three tables in fixed order - summary, daily availability,
/// incidents - separated by a blank line. Each table carries its own header row, so the file is
/// one RFC 4180 document whose sections any CSV parser can slice by header.
/// </para>
/// </summary>
public static class CsvWriter
{
    private static readonly string[] SummaryHeaders =
    {
        "service_id", "from", "to", "slo_target_pct", "availability_pct", "total_downtime_minutes",
        "total_requests", "failed_requests", "error_budget_minutes", "error_budget_pct_remaining", "burn_rate",
        "generated_at"
    };

    private static readonly string[] DailyHeaders = { "date", "uptime_pct", "requests", "errors" };

    private static readonly string[] IncidentHeaders =
    {
        "started_at", "ended_at", "duration_minutes", "estimated_failed_requests", "severity"
    };

    /// <summary>Renders a full SLA report as a sectioned RFC 4180 CSV document.</summary>
    /// <param name="report">The report to render.</param>
    /// <returns>The CSV document with CRLF line endings.</returns>
    public static string WriteSlaReport(SlaReport report)
    {
        var builder = new StringBuilder();

        AppendTable(builder, SummaryHeaders, new[] { SummaryCells(report) });
        builder.Append("\r\n");
        AppendTable(builder, DailyHeaders, report.Daily.Select(DailyCells));
        builder.Append("\r\n");
        AppendTable(builder, IncidentHeaders, report.Incidents.Select(IncidentCells));

        return builder.ToString();
    }

    /// <summary>Escapes a single CSV cell per RFC 4180.</summary>
    /// <param name="value">Cell value; null renders as an empty field.</param>
    /// <returns>The escaped field text, without a trailing separator.</returns>
    public static string Escape(object? value)
    {
        string text = value switch
        {
            null => string.Empty,
            string s => s,
            DateTimeOffset dto => dto.ToString("O", CultureInfo.InvariantCulture),
            DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString() ?? string.Empty
        };

        bool mustQuote = text.Contains(',') || text.Contains('"') || text.Contains('\r') || text.Contains('\n');
        return mustQuote ? "\"" + text.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : text;
    }

    private static void AppendTable(StringBuilder builder, string[] headers, IEnumerable<IReadOnlyList<object?>> rows)
    {
        AppendRow(builder, headers);
        foreach (IReadOnlyList<object?> row in rows)
        {
            AppendRow(builder, row);
        }
    }

    private static void AppendRow(StringBuilder builder, IEnumerable<object?> cells)
    {
        bool first = true;
        foreach (object? cell in cells)
        {
            if (!first)
            {
                builder.Append(',');
            }

            builder.Append(Escape(cell));
            first = false;
        }

        builder.Append("\r\n");
    }

    private static IReadOnlyList<object?> SummaryCells(SlaReport report)
    {
        AvailabilitySummary s = report.Summary;
        return new object?[]
        {
            report.ServiceId, report.From, report.To, report.SloTarget, s.AvailabilityPct, s.TotalDowntime,
            s.TotalRequests, s.FailedRequests, s.ErrorBudgetMinutes, s.ErrorBudgetPctRemaining, s.BurnRate,
            report.GeneratedAt
        };
    }

    private static IReadOnlyList<object?> DailyCells(DailyAvailabilityRow row)
    {
        return new object?[] { row.Date, row.UptimePct, row.Requests, row.Errors };
    }

    private static IReadOnlyList<object?> IncidentCells(IncidentSummaryReport incident)
    {
        return new object?[]
        {
            incident.StartedAt, incident.EndedAt, incident.DurationMinutes,
            incident.EstimatedFailedRequests, incident.Severity
        };
    }
}

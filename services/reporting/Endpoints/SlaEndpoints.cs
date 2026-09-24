using System.Text;

using Lodestar.Reporting.Models;
using Lodestar.Reporting.Services;

namespace Lodestar.Reporting.Endpoints;

/// <summary>
/// SLA report endpoints under <c>/v1/reports</c>: generate, list, fetch and export.
/// </summary>
public static class SlaEndpoints
{
    private const int DefaultListLimit = 50;
    private const int MaxListLimit = 500;
    private const int MaxServiceIdLength = 128;

    /// <summary>Maps the SLA report endpoint group.</summary>
    /// <param name="app">The route builder to extend.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSlaEndpoints(this IEndpointRouteBuilder app)
    {
        RouteGroupBuilder group = app.MapGroup("/v1/reports").WithTags("Reports");

        group.MapPost("/sla", GenerateReportAsync)
            .WithSummary("Generate an SLA report")
            .WithDescription(
                "Computes availability, error budget, daily rollups and incidents for one service over a " +
                "window and persists the report. Returns 201 with the report and its Location.");

        group.MapGet("/sla/{id:guid}/export", ExportReportAsync)
            .WithSummary("Export a report")
            .WithDescription(
                "Renders a stored report as RFC 4180 CSV (format=csv) or the full JSON document " +
                "(format=json, the default).");

        group.MapGet("", ListReportsAsync)
            .WithSummary("List stored reports")
            .WithDescription("Lists reports newest first, optionally filtered by serviceId.");

        group.MapGet("/{id:guid}", GetReportAsync)
            .WithSummary("Fetch a stored report")
            .WithDescription("Returns the full JSON document of one stored report.");

        return app;
    }

    private static async Task<IResult> GenerateReportAsync(
        SlaReportRequest request,
        ReportGenerator generator,
        IReportStore store,
        CancellationToken cancellationToken)
    {
        Dictionary<string, string[]> errors = ValidateRequest(request);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        SlaReport report = generator.Generate(request.ServiceId, request.From, request.To, request.SloTarget);
        await store.SaveAsync(report, cancellationToken).ConfigureAwait(false);
        return Results.Created($"/v1/reports/{report.Id}", report);
    }

    private static async Task<IResult> ExportReportAsync(
        Guid id,
        string? format,
        IReportStore store,
        CancellationToken cancellationToken)
    {
        SlaReport? report = await store.GetAsync(id, cancellationToken).ConfigureAwait(false);
        if (report is null)
        {
            return NotFound(id);
        }

        var resolvedFormat = ReportFormat.Json;
        if (!string.IsNullOrWhiteSpace(format) && !Enum.TryParse(format.Trim(), ignoreCase: true, out resolvedFormat))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid format",
                detail: "format must be one of: csv, json");
        }

        return resolvedFormat == ReportFormat.Csv
            ? Results.Text(CsvWriter.WriteSlaReport(report), "text/csv", Encoding.UTF8)
            : Results.Json(report);
    }

    private static async Task<IResult> ListReportsAsync(
        string? serviceId,
        int? limit,
        IReportStore store,
        CancellationToken cancellationToken)
    {
        int effectiveLimit = limit is null or < 1 ? DefaultListLimit : Math.Min(limit.Value, MaxListLimit);
        IReadOnlyList<SlaReport> reports = await store
            .ListAsync(serviceId, effectiveLimit, cancellationToken)
            .ConfigureAwait(false);
        return Results.Ok(reports);
    }

    private static async Task<IResult> GetReportAsync(Guid id, IReportStore store, CancellationToken cancellationToken)
    {
        SlaReport? report = await store.GetAsync(id, cancellationToken).ConfigureAwait(false);
        return report is null ? NotFound(id) : Results.Ok(report);
    }

    private static Dictionary<string, string[]> ValidateRequest(SlaReportRequest request)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(request.ServiceId))
        {
            errors[nameof(request.ServiceId)] = new[] { "serviceId is required" };
        }
        else if (request.ServiceId.Length > MaxServiceIdLength)
        {
            errors[nameof(request.ServiceId)] = new[] { $"serviceId must be at most {MaxServiceIdLength} characters" };
        }

        if (request.From >= request.To)
        {
            errors[nameof(request.From)] = new[] { "from must be earlier than to" };
        }
        else if ((request.To - request.From).TotalDays > ReportGenerator.MaxWindowDays)
        {
            errors[nameof(request.To)] = new[] { $"the window may span at most {ReportGenerator.MaxWindowDays} days" };
        }

        if (request.To > DateTimeOffset.UtcNow.AddHours(1))
        {
            errors[nameof(request.To)] = new[] { "to may not be more than one hour in the future" };
        }

        if (request.SloTarget is not (null or > 0 and < 100))
        {
            errors[nameof(request.SloTarget)] = new[] { "sloTarget must be greater than 0 and less than 100" };
        }

        return errors;
    }

    private static IResult NotFound(Guid id)
    {
        return Results.Problem(
            statusCode: StatusCodes.Status404NotFound,
            title: "Report not found",
            detail: $"No report with id {id} exists (it may have been removed by retention).");
    }
}

using System.Text.Json.Serialization;

using Lodestar.Reporting.Endpoints;
using Lodestar.Reporting.Models;
using Lodestar.Reporting.Services;

using Microsoft.Extensions.Options;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// Options pattern: bind and validate Reporting:{DataDir,DefaultSlo,RetentionDays} at startup so
// bad configuration fails fast instead of surfacing on the first report request.
builder.Services
    .AddOptions<ReportingOptions>()
    .Bind(builder.Configuration.GetSection(ReportingOptions.SectionName))
    .Validate(
        options => options.DefaultSlo is > 0 and < 100,
        "Reporting:DefaultSlo must be greater than 0 and less than 100")
    .Validate(
        options => options.RetentionDays >= 1,
        "Reporting:RetentionDays must be at least 1 day")
    .Validate(
        options => !string.IsNullOrWhiteSpace(options.DataDir),
        "Reporting:DataDir must not be empty")
    .ValidateOnStart();

// Singleton pipeline: telemetry source, calculator and store are stateless or internally
// synchronized, so one instance each keeps the process lean and the report math reproducible.
builder.Services.AddSingleton<ITelemetrySource, SimulatedTelemetrySource>();
builder.Services.AddSingleton<ISlaCalculator, SlaCalculator>();
builder.Services.AddSingleton<IReportStore, FileReportStore>();
builder.Services.AddSingleton<ReportGenerator>();
builder.Services.AddHostedService<RetentionWorker>();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    // Null properties are omitted so optional report fields (e.g. absent incident lists on
    // quiet windows) do not clutter API responses.
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Lodestar Reporting API",
        Version = "v1",
        Description =
            "SLA/SLO availability reporting for Lodestar services. Computes availability, error " +
            "budgets, daily rollups and incident summaries from hourly telemetry, stores reports " +
            "and exports them as CSV or JSON."
    });
});

// CORS is a development convenience for the Next.js dashboard; production traffic goes through
// the platform gateway, which is same-origin from the browser's perspective.
builder.Services.AddCors(options => options.AddPolicy("dev", policy =>
    policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "Lodestar Reporting API v1"));
    app.UseCors("dev");
}

app.MapSlaEndpoints();
app.MapHealthEndpoints();

ReportingOptions reportingOptions = app.Services.GetRequiredService<IOptions<ReportingOptions>>().Value;
app.Logger.LogInformation(
    "Lodestar reporting ({Environment}) listening on port 4200; dataDir={DataDir}; defaultSlo={Slo}%; retentionDays={Retention}",
    app.Environment.EnvironmentName,
    reportingOptions.DataDir,
    reportingOptions.DefaultSlo,
    reportingOptions.RetentionDays);

app.Run();

namespace Lodestar.Reporting.Endpoints;

/// <summary>
/// Liveness/readiness endpoint.
///
/// <para>
/// The same handler serves the API contract path (<c>/v1/health</c>) and the platform probe path
/// (<c>/healthz</c>) targeted by the docker-compose healthcheck and the Kubernetes probes, so
/// both conventions work without a reverse-proxy rewrite.
/// </para>
/// </summary>
public static class HealthEndpoints
{
    /// <summary>Maps the health endpoints.</summary>
    /// <param name="app">The route builder to extend.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/health", HealthAsync)
            .WithTags("Health")
            .WithSummary("Service health")
            .WithDescription("Reports service identity and liveness.");

        app.MapGet("/healthz", HealthAsync)
            .WithTags("Health")
            .WithSummary("Service health (platform probe path)");

        return app;
    }

    private static IResult HealthAsync(HttpContext context)
    {
        IHostEnvironment environment = context.RequestServices.GetRequiredService<IHostEnvironment>();
        return Results.Ok(new
        {
            status = "ok",
            service = "reporting",
            environment = environment.EnvironmentName,
            checkedAt = DateTimeOffset.UtcNow
        });
    }
}

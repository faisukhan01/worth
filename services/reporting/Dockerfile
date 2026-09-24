# Lodestar reporting - multi-stage build.
# Stage 1 publishes with the .NET 8 SDK; stage 2 ships the minimal ASP.NET runtime.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Lodestar.Reporting.csproj ./
RUN dotnet restore ./Lodestar.Reporting.csproj

COPY . .
RUN dotnet publish ./Lodestar.Reporting.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0

# Reports live under the reporting data dir. /tmp is writable in every runtime profile
# (including readOnlyRootFilesystem Kubernetes pods with a tmp emptyDir); mount a real volume
# and override Reporting__DataDir for durable report storage.
ENV ASPNETCORE_URLS=http://+:4200 \
    ASPNETCORE_ENVIRONMENT=Production \
    Reporting__DataDir=/tmp/reporting

# The .NET 8 runtime images ship the non-root `app` user and curl (used by the healthcheck).
WORKDIR /app
COPY --from=build /app .

USER app

EXPOSE 4200

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:4200/healthz || exit 1

ENTRYPOINT ["dotnet", "Lodestar.Reporting.dll"]

# Local development targets for the Lodestar reporting service (port 4200).
# Requires the .NET 8 SDK on PATH (see repo-root toolchain notes in worklog.md).

DOTNET ?= dotnet
TAG    ?= 0.1.0

.PHONY: run build publish clean docker-build

## run: start the service locally on http://localhost:4200
run:
	$(DOTNET) run

## build: compile in Release mode (warnings are errors)
build:
	$(DOTNET) build -c Release

## publish: publish a framework-dependent Release build to ./publish
publish:
	$(DOTNET) publish -c Release -o publish

## clean: remove build output and compiled artifacts
clean:
	$(DOTNET) clean

## docker-build: build the multi-stage container image
docker-build:
	docker build -t lodestar/reporting:$(TAG) .

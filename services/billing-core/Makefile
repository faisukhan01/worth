# Local development targets for the Lodestar billing-core service (port 4100).
# Requires JDK 17+ and Maven on PATH (see repo-root toolchain notes in worklog.md).

MVN ?= mvn
TAG  ?= 0.1.0

.PHONY: run build clean docker-build

## run: start the service locally on http://localhost:4100
run:
	$(MVN) spring-boot:run

## build: compile and package the executable jar (target/billing-core-0.1.0.jar)
build:
	$(MVN) -DskipTests package

## clean: remove build output and compiled classes
clean:
	$(MVN) clean

## docker-build: build the multi-stage container image
docker-build:
	docker build -t lodestar/billing-core:$(TAG) .

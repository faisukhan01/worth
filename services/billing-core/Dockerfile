# Lodestar billing-core - multi-stage build.
# Stage 1 builds the fat jar with Maven on Temurin 17; stage 2 ships a minimal JRE runtime.

FROM maven:3-eclipse-temurin-26 AS build
WORKDIR /build

COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:17-jre-alpine

RUN addgroup -S lodestar && adduser -S lodestar -G lodestar

WORKDIR /app
COPY --from=build /build/target/billing-core-*.jar app.jar

# The container keeps the embedded H2 file database on a dedicated volume.
ENV SPRING_DATASOURCE_URL=jdbc:h2:file:/data/billing
VOLUME ["/data"]

RUN mkdir -p /data && chown -R lodestar:lodestar /app /data

USER lodestar

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD wget -qO- http://127.0.0.1:4100/actuator/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]

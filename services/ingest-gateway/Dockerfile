# Lodestar ingest-gateway - high-throughput telemetry ingestion service.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gateway ./cmd/gateway

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/gateway /gateway
ENV PORT=3100
EXPOSE 3100
USER nonroot
ENTRYPOINT ["/gateway"]

FROM alpine:3.20 AS build
RUN apk add --no-cache gcc musl-dev make
WORKDIR /src
COPY Makefile src/ ./
RUN make pulseagent

FROM alpine:3.20
COPY --from=build /src/pulseagent /usr/local/bin/pulseagent
ENV PULSE_GATEWAY_URL=http://ingest-gateway:3100
USER nobody
ENTRYPOINT ["/usr/local/bin/pulseagent"]

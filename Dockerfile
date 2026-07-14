FROM rust:1.88-bookworm@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe0 AS build
WORKDIR /src
COPY . .
RUN cargo build --release
FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
LABEL org.opencontainers.image.source="https://github.com/open-leash/local-proxy"
LABEL org.opencontainers.image.description="OpenLeash local policy enforcement proxy"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 openleash
COPY --from=build /src/target/release/openleash-local-proxy /usr/local/bin/openleash-local-proxy
USER openleash
EXPOSE 9320
ENTRYPOINT ["openleash-local-proxy"]

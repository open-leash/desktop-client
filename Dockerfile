FROM rust:1.88-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 openleash
COPY --from=build /src/target/release/openleash-local-proxy /usr/local/bin/openleash-local-proxy
USER openleash
EXPOSE 9320
ENTRYPOINT ["openleash-local-proxy"]

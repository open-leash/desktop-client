# OpenLeash container plugin example

An OpenLeash plugin is an OCI image plus a manifest. It may be implemented in any language; it does not link against the OpenLeash server.

1. Subscribe to normalized events in `openleash.plugin.json`.
2. Implement `GET /healthz` and `POST /v1/events` using `openleash-container-plugin.v1`.
3. Verify the request HMAC and echo `protocol` and `requestId` in every response.
4. Build and publish a versioned image, obtain its immutable registry digest, and put that digest in the manifest.
5. Submit the manifest to the marketplace or install it into a Private Cloud catalog.

```sh
docker build -t ghcr.io/acme/openleash-command-review:1.0.0 examples/container-plugin
docker push ghcr.io/acme/openleash-command-review:1.0.0
docker buildx imagetools inspect ghcr.io/acme/openleash-command-review:1.0.0
```

The container receives only the declared event payload, resolved configuration, tenant scope, and opaque capability results. It never receives OpenLeash database credentials, model-provider keys, or a Docker socket. Privileged behavior is requested through the host-mediated capability round trip described in `apps/client-api/src/plugins/README.md`.

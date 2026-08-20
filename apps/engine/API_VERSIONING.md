# Leash client API versioning

Leash desktop and mobile clients may stay installed while the hosted API is
deployed many times. A cloud deployment must not force an already installed
client to stop working.

## Compatibility contract

- `/v1` is the stable public client API major version.
- Existing `/v1` routes and the unversioned desktop update routes remain
  available for every released v1 client.
- Clients send `x-openleash-api-function` and
  `x-openleash-api-version` when their release knows the contract.
- Headerless clients are treated as legacy v1 clients and remain supported.
- The server returns its current contract in `x-openleash-api-version`, the
  contract used for the request in `x-openleash-api-negotiated-version`, and
  the compatibility mode in `x-openleash-api-compatibility`.
- Older dated contracts with the same function name and `v1` major version are
  accepted. This lets the server add optional response fields without breaking
  installed clients.
- Request fields added inside v1 must be optional or have server defaults.
- Existing response fields cannot be removed, renamed, or change meaning
  inside v1.
- A breaking request or response change requires a `/v2` route and a v2
  contract. The v1 route stays in place with its adapter for released clients.

## Release checks

Every API change must keep the compatibility tests passing. Tests cover:

- headerless legacy clients;
- the current contract;
- older dated v1 contracts;
- rejection of unrelated, future, or v2 contracts;
- the legacy local-hook contract used by released desktop clients;
- platform-specific desktop update responses.

The desktop update API discovers the latest public GitHub release automatically.
This gives an older compatible client a direct path to the newest desktop build
without requiring a separate release-feed publication step.

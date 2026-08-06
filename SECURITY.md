# Security policy

## Supported versions

Security fixes are applied to the latest commit on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for the
[`open-leash/flow-viewer`](https://github.com/open-leash/flow-viewer) repository.
Do not open a public issue containing a trace, prompt, credential, or exploit.

## Trace-data boundary

Flow Viewer is a read-only development tool, but the trace it renders can
contain sensitive source code, prompts, tool inputs, model responses, file
paths, and policy evidence.

- The HTTP server binds to `127.0.0.1` by default.
- Trace files are never uploaded by this app.
- Responses are non-cacheable and use a restrictive Content Security Policy.
- The trace filename is ignored by Git.
- Binding to a non-loopback address is an explicit operator action and should
  be protected by authenticated ingress and transport encryption.

Flow Viewer is not an enforcement boundary. Security decisions remain in the
Leash `client-api`, desktop edge, and plugin pipeline.

# External agent events

Leash may ingest supported provider events that occur outside the local desktop process. These events use the same authenticated personal `client-api`, normalization pipeline, built-in Feature handlers, outcomes, approvals, and flow tracing as local hooks.

Connectors must be idempotent and checkpointed. Retries must not duplicate events. Credentials are stored per personal account, encrypted at rest, and never copied into the desktop cache or Feature input.

There is no organization connector administration or dashboard surface in the public product. A connector that cannot authenticate a personal account must remain unavailable.

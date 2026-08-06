# Leash data model

Postgres is the durable backend for Leash Cloud and Personal Open Source. The desktop SQLite database is only local cache and setup state; it is not a supported standalone backend.

The public product stores personal users, computers, agent runtimes, conversation events, evaluations, approvals, Feature settings, outcomes, mobile devices, update releases, and flow/audit records.

Some table and column names retain organization or plugin terminology for migration compatibility. Public API behavior is personal-only, and new code must not add dashboard sessions, organization administration, identity-provider configuration, marketplace submissions, publisher metadata, ratings, or download analytics.

Features share the client API process and database provider interfaces. They receive bounded capability inputs rather than direct database credentials.

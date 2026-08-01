# Deployment And Updates

OpenLeash has three backend-backed deployment modes. Desktop always talks to a configured `client-api`; it is never a standalone desktop-only product.

## Individual Open Source

Local open-source install for one developer.

Install:

```bash
curl -fsSL https://openleash.com/install.sh | bash -s -- --open-source
```

Equivalent:

```bash
curl -fsSL https://openleash.com/install.sh | bash -s -- --mode individual-open-source
```

The installer:

1. Installs the desktop app.
2. Checks Docker and Docker Compose.
3. Creates `~/.openleash/individual-open-source`.
4. Writes a persistent Compose runtime with Postgres and `client-api`.
5. Pulls `ghcr.io/open-leash/client-api:<version>`.
6. Runs migrations and seeds one local account.
7. Starts `client-api` on `127.0.0.1:9318`.
8. Launches desktop against the local API.

Pin a backend image:

```bash
curl -fsSL https://openleash.com/install.sh | bash -s -- --open-source --version 0.36.0
```

Update the local backend:

```bash
cd ~/.openleash/individual-open-source
docker compose pull
docker compose --profile setup run --rm migrate
docker compose --profile setup run --rm seed
docker compose up -d client-api
```

## Managed Self-Hosted / Private Cloud

Operator-run OpenLeash for an organization.

Runtime:

- Postgres 16 or compatible managed Postgres.
- `client-api` reachable by desktop and mobile clients.
- `dashboard-api` and `dashboard-web` reachable by admins.
- Optional identity sync service.
- Optional private update feed.

Setup:

1. Create Postgres and store `DATABASE_URL` in the platform secret manager.
2. Run migrations as a one-shot job.
3. Deploy `client-api`, `dashboard-api`, and `dashboard-web`.
4. Set a one-time `OPENLEASH_PRIVATE_BOOTSTRAP_TOKEN` in the dashboard API secret store.
5. Admin opens the customer-hosted dashboard and uses that value to create the first local recovery owner.
6. Admin configures workforce identity, delegated roles, policy, plugin governance, model-provider settings, and deployment tokens.
7. After a second administrator can sign in through workforce identity, rotate or remove the bootstrap value and retain the local owner as a controlled recovery account.
8. Endpoints enroll against the customer-managed `client-api` URL.

Use:

```text
OPENLEASH_DEPLOYMENT_MODE=private
```

Required customer values:

- Customer `client-api` URL.
- Customer dashboard URL.
- Postgres connection string.
- One-time Private Cloud bootstrap value.
- Identity provider credentials.
- Model-provider credentials or BYOK settings.
- Update mode: public feed, private feed, or manual distribution.

For the Docker Compose reference deployment, generate unique high-entropy values for `OPENLEASH_POSTGRES_PASSWORD`, `OPENLEASH_PRIVATE_BOOTSTRAP_TOKEN`, `OPENLEASH_PLUGIN_RUNTIME_SECRET`, `OPENLEASH_MODEL_KEY_ENCRYPTION_KEY`, `OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY`, and `OPENLEASH_SECRET_KEY`. Store them in a secret manager or a root-readable environment file; do not commit them. Set browser-reachable HTTPS URLs for the dashboard and client APIs. The reference stack builds and runs Identity Loader internally at `http://identity-loader:8080`; override `OPENLEASH_IDENTITY_LOADER_URL` only when operating it separately. Postgres is intentionally not published on a host port by the reference Compose stack.

Terminate TLS at the customer load balancer or ingress, restrict the dashboard to the administrative access plane, restrict API ingress to enrolled clients and configured hook providers, and send audit logs to the customer SIEM. Back up Postgres before upgrades and test restore procedures regularly.

## Managed OpenLeash Cloud

Hosted OpenLeash. Customers do not deploy infrastructure.

- Solo users sign in from desktop, mobile, or web and stay in personal client surfaces.
- Organization admins sign in with work identity and continue onboarding in the hosted dashboard.
- Employees sign in through the organization identity provider and inherit managed policy.

Hosted tenancy, billing, abuse controls, signing, production credentials, and cloud ops live outside the public repo.

## Local Development

Use the mode runner:

```bash
npm run dev:mode:individual-open-source
npm run dev:mode:self-hosted
npm run dev:mode:cloud
```

All modes use local Postgres in development by default.

## Database Migrations

Fresh database:

```bash
python3 migrate.py --target custom --database-url 'postgres://...' --scope core --apply --yes
```

Upgrade with backup:

```bash
python3 migrate.py --target custom --database-url 'postgres://...' --scope core --backup-apply --yes
```

Read-only status:

```bash
python3 migrate.py --target custom --database-url 'postgres://...' --scope core --status --yes
```

For Kubernetes, run migrations as a Job using the same image version as the APIs. Back up Postgres and rehearse rollback before each upgrade.

## Docker Images

Build:

```bash
npm run docker:build -- --version 0.36.0
```

Publish:

```bash
npm run docker:publish -- --version 0.36.0
```

Default public images:

- `ghcr.io/open-leash/client-api:<version>`
- `ghcr.io/open-leash/dashboard-web:<version>`
- `ghcr.io/open-leash/local-proxy:<version>`
- `ghcr.io/open-leash/provider-puller:<version>`
- `ghcr.io/open-leash/plugin-token-saver:<version>`

`client-api` is the shared API runtime image. Set `OPENLEASH_API_SURFACE=client`
or `OPENLEASH_API_SURFACE=dashboard`; there is no second, duplicate dashboard API
image. Every OCI package name otherwise matches the GitHub source repository name.

Optional public web images:

```bash
npm run docker:publish -- --version 0.36.0 --include-web
```

Cloud wrapper images are OpenLeash-operated artifacts:

```bash
npm run docker:publish -- --version 0.36.0 --include-cloud
```

Those package names are `cloud-client-api`, `cloud-dashboard-api`, and
`cloud-dashboard-web`, matching their source repositories.

## Updates

The update contract is public and served by `client-api`.

- Desktop uses the OpenLeash public update feed by default.
- Individual Open Source backend updates use Docker pulls plus migrations.
- Private Cloud may use public desktop updates, a private update feed, or manual distribution.
- OpenLeash Cloud can use private signing, storage, and release automation outside this repo.

## MDM Targets

First-class docs should exist for Jamf Pro, Kandji, Microsoft Intune, and Workspace ONE.

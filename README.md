# HERMES

Open-source multi-domain mail server built with Tachyon for HTTP/frontend routes and Fylo for local file-backed persistence.

## Requirements

- Bun 1.3 or newer
- A writable Fylo data directory
- `JWT_SECRET` set to a strong random value outside local development

## Local Development

```sh
bun install
bun run test
bun run test:e2e
```

Run the API server:

```sh
FYLO_ROOT=.data \
JWT_SECRET=dev-secret-change-me \
INBOUND_WEBHOOK_SECRET=dev-inbound-secret \
bun run serve
```

Build the frontend for CDN/static hosting:

```sh
HERMES_API_URL=https://api.example.com bun run bundle
```

The static frontend build is written to `dist/`.

## Mailbox Features

The inbox supports server-side search through `GET /inbox` query parameters. Use `q` for plain text search across sender, recipient, subject, body, and attachment filenames. Search terms also support `from:`, `to:`, `subject:`, `body:`, `filename:`, `has:attachment`, `is:read`, `is:unread`, and `is:starred`.

Messages track read/unread and starred state, plus folders such as `inbox`, `archive`, and `trash`. Authenticated clients can update these fields with `PUT /inbox/:id` before permanently deleting a message with `DELETE /inbox/:id`.

## Mobile And PWA Shell

The installable PWA uses the same Tachyon frontend as the mobile web app. Phone-sized screens switch from the desktop sidebar to a bottom navigation bar, account for device safe areas, and keep inbox filters and email actions touch-friendly with horizontal chip strips.

The existing web manifest provides standalone display metadata, theme colors, shortcuts, and maskable icons for installed desktop and mobile app launchers. Keep those assets aligned with any future splash screen or branding updates.

## Docker

Published images are available on Docker Hub at [`d3lma/hermes`](https://hub.docker.com/r/d3lma/hermes). Every push to `main` builds and publishes an image tagged with the `package.json` version (for example `0.2.0`) and `latest`. Images are multi-arch (`linux/amd64`, `linux/arm64`).

### Run the published image

```sh
docker run --rm \
  -p 8080:8080 \
  -e JWT_SECRET=change-me \
  -e INBOUND_WEBHOOK_SECRET=change-me-too \
  -e WEB_PUSH_DISABLED=true \
  -e FYLO_ROOT=/data \
  -v hermes-data:/data \
  d3lma/hermes:latest
```

The container serves the API on `PORT` and stores data under `FYLO_ROOT`. Build the frontend separately with `bun run bundle` when distributing it through a CDN.

The image uses a narrow entrypoint. By default it only accepts these commands:

- `serve`: start Hermes
- `admin:create`: create the first admin for a domain

Any other command is rejected by the default entrypoint unless an operator deliberately overrides the container entrypoint.

### Build locally

```sh
docker build -t hermes:local .
```

### Image hardening

The runtime image is built on `oven/bun:<version>-distroless` for a minimal attack surface:

- No shell, no package manager, no coreutils — attackers who land in a running container have very little to work with.
- Runs as non-root user `65532:65532`.
- Base images are pinned to SHA digests in the Dockerfile for reproducible builds.
- Test-only routes under `routes/test/**` are omitted from the production image.
- Merge-gating image blackbox tests are loaded from a private CI-only repository, not from this public source tree.

Trade-offs: `docker exec -it <container> sh` will not work, and the image is not intended for interactive debugging. For troubleshooting, reproduce the failure locally with `hermes:local` built from the repo, or run a sidecar built on a full Bun image.

### Private Blackbox Tests

The CI workflow builds the production Docker image, starts it, and then checks out a private blackbox test suite into `.blackbox-tests/`. The test source is intentionally not committed to this repository. Configure these GitHub settings before requiring the `Image blackbox tests` check:

- `HERMES_BLACKBOX_REPOSITORY` variable or secret: private repository name, for example `Chidelma/NightJar`
- `HERMES_BLACKBOX_SSH_KEY` secret: private half of a read-only deploy key for that private repository
- `HERMES_BLACKBOX_REF` variable: optional branch, tag, or SHA; defaults to `main`

The private suite receives `HERMES_IMAGE`, `HERMES_URL`, and `INBOUND_WEBHOOK_SECRET`. If its `package.json` defines a `blackbox` script, CI runs `bun run blackbox`; otherwise it runs `bun test . --timeout 120000`.

### Extending the image

Because the runtime base is distroless, downstream Dockerfiles can add files and configuration but cannot run shell commands. This works:

```dockerfile
FROM d3lma/hermes:0.2.0

COPY --chown=65532:65532 my-routes/   /app/routes/custom/
COPY --chown=65532:65532 my-config.json /app/config.json
ENV CUSTOM_FLAG=true
```

Files placed under `/app/routes/` are picked up automatically by Tachyon's file-system router. Static assets, components, and configuration work the same way.

`RUN` commands that require a shell will not work (`bun install`, `apt-get`, shell scripts). To add new npm dependencies, do a multi-stage build yourself: run `bun install` in a full Bun image and copy `node_modules` into a layer on top of `d3lma/hermes`.

Bind-mounting at runtime is always an option for ad-hoc additions:

```sh
docker run --rm \
  -p 8080:8080 \
  -e JWT_SECRET=change-me \
  -e INBOUND_WEBHOOK_SECRET=change-me-too \
  -e WEB_PUSH_DISABLED=true \
  -e FYLO_ROOT=/data \
  -v hermes-data:/data \
  -v $(pwd)/my-routes:/app/routes/custom:ro \
  d3lma/hermes:latest
```

Bind-mount sources should be owned by uid `65532` on the host (or world-readable) to satisfy the non-root container user.

## Attachments

Inbound MIME attachments are parsed from raw message bodies and stored as files on the local filesystem. Attachment metadata is stored in Fylo, while file bytes are written under `ATTACHMENT_ROOT`. Local development falls back to `${FYLO_ROOT}/attachments`; production must set `ATTACHMENT_ROOT` explicitly. The Docker image defaults it to `/data/attachments`.

The inbox API returns attachment metadata with message details, and authenticated clients can fetch attachment content from the attachment endpoint.

## Push Notifications

Hermes can notify installed desktop and mobile PWA users when new mail is delivered. For production, generate VAPID keys and provide them to the API process:

```sh
bun node_modules/.bin/web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in the API environment. Local development falls back to an in-memory VAPID keypair, which is convenient for testing but not stable across restarts. Production requires VAPID keys unless `WEB_PUSH_DISABLED=true`.

## Admin Bootstrap

Create the first admin for a new domain from a trusted shell with access to the Fylo data directory:

```sh
FYLO_ROOT=.data bun run admin:create --email=admin@example.com --phone=+14165550100 --domain=example.com
```

For the hardened Docker image, run the same bootstrap as an explicit one-shot container command against the same data volume:

```sh
docker run --rm \
  -v hermes-data:/data \
  d3lma/hermes:latest \
  admin:create --email=admin@example.com --phone=+14165550100 --domain=example.com
```

Run this before starting the API container, or stop the API container briefly while bootstrapping the first account against an existing volume. The command creates the domain with a default `*@domain` store route if it does not already exist, then creates an admin user scoped to that domain. After the first admin exists, use the Settings screen or `POST /users` to add more users for domains that admin is allowed to manage.

Inbound relay integrations must sign the exact JSON payload with HMAC-SHA256 using `INBOUND_WEBHOOK_SECRET` and send it as `X-Hermes-Signature`.

## Environment

- `HOST`: bind address, default `0.0.0.0` in Docker
- `PORT`: HTTP port, default `8080` in Docker
- `FYLO_ROOT`: Fylo data directory, default `/data` in Docker
- `ATTACHMENT_ROOT`: attachment file directory, required in production
- `JWT_SECRET`: signing key for session tokens, required
- `INBOUND_WEBHOOK_SECRET`: HMAC key required by `/inbound/webhook`
- `VAPID_PUBLIC_KEY`: public VAPID key for Web Push subscriptions, required in production unless push is disabled
- `VAPID_PRIVATE_KEY`: private VAPID key for Web Push delivery, required in production unless push is disabled
- `VAPID_SUBJECT`: contact URI for Web Push, for example `mailto:admin@example.com`
- `WEB_PUSH_DISABLED`: set to `true` to skip delivery attempts in controlled environments
- `SMS_ADAPTER`: SMS provider selector, currently defaults to `console`
- `SMTP_ADAPTER`: SMTP provider selector, currently defaults to `console`

# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY assets ./assets
COPY components ./components
COPY docker ./docker
COPY main.js ./main.js
COPY routes ./routes
COPY scripts/create-admin.mjs ./scripts/create-admin.mjs
COPY src ./src
COPY tsconfig.json ./tsconfig.json

RUN find routes -type f -exec sed -i '1s|^#!/usr/bin/env bun|#!/usr/local/bin/bun|' {} + \
    && find routes -type f -exec chmod 755 {} + \
    && mkdir -p /data-empty

FROM oven/bun:1.3.11-distroless@sha256:6a78966e057efd546873b64d6c173b18a21a10c3da81562863beeaf044c1e2ec

COPY --from=builder --chown=65532:65532 /app /app
COPY --from=builder --chown=65532:65532 /data-empty /data

WORKDIR /app
USER 65532:65532

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    FYLO_ROOT=/data \
    ATTACHMENT_ROOT=/data/attachments

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["/usr/local/bin/bun","-e","const r=await fetch('http://127.0.0.1:'+(process.env.PORT||'8080')+'/');process.exit(r.ok?0:1)"]

ENTRYPOINT ["/usr/local/bin/bun", "/app/docker/entrypoint.mjs"]
CMD ["serve"]

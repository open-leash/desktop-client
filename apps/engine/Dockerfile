FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder
WORKDIR /app
RUN apk add --no-cache git
ARG OPENLEASH_SHARED_REF=b19b7e11f314af8bffd040efc491595c989412b3
RUN git clone https://github.com/open-leash/shared.git packages/shared \
    && git -C packages/shared checkout --detach "$OPENLEASH_SHARED_REF"
COPY . apps/client-api
RUN printf '%s\n' \
  '{"private":true,"type":"module","workspaces":["packages/*","apps/*"]}' \
  > package.json
RUN npm install --workspace @openleash/shared --workspace @openleash/client-api
RUN npm run build -w @openleash/shared && npm run build -w @openleash/client-api
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner
LABEL org.opencontainers.image.source="https://github.com/open-leash/client-api" \
      org.opencontainers.image.title="Leash client-api" \
      org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
ENV NODE_ENV=production
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=builder /app/apps/client-api/package.json ./apps/client-api/package.json
COPY --chown=node:node --from=builder /app/apps/client-api/dist ./apps/client-api/dist
COPY --chown=node:node --from=builder /app/apps/client-api/infra ./apps/client-api/infra
USER node
EXPOSE 9318
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OPENLEASH_API_PORT||9318)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/client-api/dist/server.js"]

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]

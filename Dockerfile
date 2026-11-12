FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS compile
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY scripts/clean.ts ./scripts/clean.ts
COPY src ./src
RUN npm run build

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    UPLOAD_TEMP_DIR=/tmp \
    LOG_LEVEL=info \
    NODE_OPTIONS=--max-old-space-size=256
# Root owns executable content; only the separately bounded temporary mount is writable.
COPY --from=compile /app/dist ./dist
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
USER node:node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/server.js"]

# CampusOS API — production image (M10-W3).
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t campusos-api .
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && mkdir -p /data/uploads \
 && chown node:node /data/uploads \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --no-fund --no-audit
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @campusos/shared \
 && npm run prisma:generate -w @campusos/api \
 && npm run build -w @campusos/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
USER node
WORKDIR /app/apps/api
# Migrations run first; the app only starts on a fully migrated schema.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

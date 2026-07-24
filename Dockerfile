# syntax=docker/dockerfile:1

# ---- Build stage: install deps (better-sqlite3 needs to compile a native binding) ----
FROM node:20-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runtime stage: slim image with just the app + compiled node_modules ----
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY . .

# Directory for the persistent volume (SQLite DB + uploaded photos) mounted
# by the hosting platform (see fly.toml). Falls back to writing here even
# if no volume is mounted, so the container never crashes on startup.
RUN mkdir -p /data/uploads

EXPOSE 3000

CMD ["node", "server.js"]

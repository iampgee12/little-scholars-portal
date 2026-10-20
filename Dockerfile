# ── Stage 1: build the Windows exam-server app and its Setup wizard ──
# (the Electron window + the official Windows node.exe engine with the portal
# files, see exam-app/build.js).
# If this stage fails the portal still deploys; the Offline CBT page then
# offers only the zip kit.
FROM node:24-slim AS exam-app
RUN apt-get update && apt-get install -y --no-install-recommends nsis unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node exam-app/build.js --installer || (echo "exam app build failed — continuing without it" && rm -rf dist && mkdir -p dist)

# ── Stage 2: the portal ──
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
COPY --from=exam-app /build/dist/ ./dist/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]

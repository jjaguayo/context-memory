# --- Stage 1: Base ---
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# --- Stage 2: Build ---
FROM base AS build
WORKDIR /usr/src/app

# Copy config files
COPY package.json pnpm-lock.yaml tsconfig.json ./

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# Copy source
COPY src ./src

# Build
RUN pnpm run build

# --- VERIFICATION: Ensure dist was actually created ---
RUN ls -la /usr/src/app/dist

# --- Stage 3: Runtime ---
FROM base AS runtime
WORKDIR /app

# Copy from build stage using absolute paths
COPY --from=build /usr/src/app/dist /app/dist
COPY --from=build /usr/src/app/node_modules /app/node_modules
COPY --from=build /usr/src/app/package.json /app/package.json

# FINAL VERIFICATION: If this fails, the build stops here
RUN ls -R /app/dist

ENV NODE_ENV=production
CMD [ "node", "dist/index.js" ]

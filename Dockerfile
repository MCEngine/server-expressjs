# syntax=docker/dockerfile:1

# Central server for MCPluginManager.
#
# Debian slim rather than Alpine, deliberately: better-sqlite3 is a native
# module that publishes prebuilt binaries against glibc and none against musl.
# On Alpine, npm falls back to compiling it, which means python3, make and g++
# in a production runtime for a dependency that has a binary two lines away.
ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------------------
# Build: devDependencies included, TypeScript compiled to dist/.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# The lockfile alone first, so a source edit does not invalidate the install
# layer. npm ci installs exactly what the lockfile pins and fails if
# package.json and the lockfile disagree, which is what makes the image
# reproducible.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Dependencies: the production set, installed on the image that will run it.
# ---------------------------------------------------------------------------
#
# Not copied from the build stage. That stage's node_modules carries
# devDependencies this must not ship, and a native module's binary is bound to
# the platform and ABI it was installed for -- so it is installed again, here,
# against this base image.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Runtime.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DIR=/data/storage

# The official Node images already carry an unprivileged `node` user at uid
# 1000. Nothing is installed at runtime, so root buys nothing past this point.
# STORAGE_DIR is the one path the service writes to.
RUN mkdir -p "${STORAGE_DIR}" && chown -R node:node /data

COPY --chown=node:node --from=deps  /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist         ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# Declared so an unmounted volume is an obvious anonymous one rather than
# bytes that vanish with the container. Artifacts live here; the database does
# too when DATABASE_PROVIDER is sqlite.
VOLUME ["/data"]

# Readiness, not liveness. /health deliberately checks nothing, because an
# orchestrator restarts what fails liveness and restarting does not fix an
# unreachable database. Docker's HEALTHCHECK restarts nothing -- it publishes
# the status that `depends_on: condition: service_healthy` and load balancers
# gate on, which is readiness.
#
# node --eval rather than curl or wget: neither is in this base image, and Node
# 22 has a global fetch, so the check adds no package.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node --eval "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and receives SIGTERM directly -- src/index.ts
# handles it and closes the server and the database before exiting. A shell
# wrapper would swallow the signal and leave the container to be killed.
#
# Migrations run at startup, from a literal list compiled into dist/, so there
# is no separate migrate step to forget.
CMD ["node", "dist/index.js"]

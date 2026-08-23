# syntax=docker/dockerfile:1
#
# fact-explorer — static SPA. Build context is the REPO ROOT (see docker-compose.yml) because this
# is one package of an npm workspace: `taxpert` resolves to ../ui through the root lockfile, so the
# root manifest and both packages have to be in scope.
# Defaults to the committed `mock` data source, so it renders with no Scala build.
# Pass --build-arg VITE_FGM_SOURCE=real to bundle the generated graph instead.

FROM node:20-alpine AS build
WORKDIR /workspace
ARG VITE_FGM_SOURCE=mock
ENV VITE_FGM_SOURCE=${VITE_FGM_SOURCE}
COPY package.json package-lock.json ./
COPY packages/ui/ packages/ui/
COPY packages/fact-explorer/ packages/fact-explorer/
RUN npm ci
WORKDIR /workspace/packages/fact-explorer

# The app registry. public/data/apps.json is generated and gitignored, so without this the built
# SPA 404s on it at boot — loadRegistry() is the first thing it does.
#
# It is written EMPTY, because this repository contains no application: every Form Builder app lives
# in its own repo, and which apps an instance serves is decided at run time by what is mounted at
# /apps (see the entrypoint below and apps/README.md). An unmounted image therefore says "no apps"
# on its own homepage instead of failing to load, and the descriptors are never baked into a layer
# they would go stale in.
RUN npm run build-registry -- --empty

RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY packages/fact-explorer/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/packages/fact-explorer/dist /usr/share/nginx/html

# Discovery has to survive the image boundary: a prebuilt image cannot know its consumer's apps.
# The entrypoint rescans a mounted /apps and rewrites the served registry; with nothing mounted the
# empty registry baked above stands, and the SPA says so. Node is here for that one script — the
# served site is still static files out of nginx.
RUN apk add --no-cache nodejs
COPY packages/fact-explorer/scripts/build-registry.mjs /app/scripts/build-registry.mjs
COPY packages/fact-explorer/docker-entrypoint.sh /docker-entrypoint-taxpert.sh
ENTRYPOINT ["/docker-entrypoint-taxpert.sh"]
CMD ["nginx", "-g", "daemon off;"]

EXPOSE 80

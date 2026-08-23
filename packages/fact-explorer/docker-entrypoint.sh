#!/bin/sh
# Regenerate the app registry from whatever descriptors are mounted at /apps, then hand off to
# nginx.
#
# The image bakes an EMPTY registry at build time, because a prebuilt image cannot know its
# consumer's apps — that is the whole point of a shared Fact Explorer, and no application ships in
# the taxpert repository. Mount one or more `<app>/fact-explorer.app.json` under /apps and the SPA
# serves them. With nothing mounted there is nothing to show, and this says so rather than
# pretending otherwise.
set -e

REGISTRY=/usr/share/nginx/html/data/apps.json

if [ -d /apps ] && [ -n "$(find /apps -name fact-explorer.app.json -print -quit 2>/dev/null)" ]; then
  echo "fact-explorer: rebuilding app registry from /apps"
  node /app/scripts/build-registry.mjs --root /apps --out "$REGISTRY"
else
  echo "fact-explorer: no fact-explorer.app.json under /apps — the registry is empty and the SPA"
  echo "fact-explorer: will say so. Mount your app repo(s) there, one directory each:"
  echo "fact-explorer:   -v /path/to/my-app:/apps/my-app:ro   (compose: TAXPERT_APPS_DIR)"
fi

exec "$@"

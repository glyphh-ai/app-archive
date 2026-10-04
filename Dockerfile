# The Glyphh web apps on Fly — ONE image, two deploys:
#   · app.glyphh.ai    (fly.toml,        glyphh-ai-app)    BUILD_SCRIPT=build:web
#       the IDENTICAL desktop app on the web (his order, 2026-10-04): the full
#       command center, every turn on a cloud worker through /api/harness/* or
#       on the member's desktop over the relay; phones still get the mobile shell.
#   · mobile.glyphh.ai (fly.mobile.toml, glyphh-ai-mobile) BUILD_SCRIPT=build:mobile
#       the mobile web app only (GLYPHH_MOBILE_ONLY=1 at runtime).
#
# Deploys go through GitHub Actions (.github/workflows/deploy-web.yml) — never a
# local `fly deploy`. The workflow vendors the `file:../sdk` dependency into
# .sdk-vendor/ (package.json + built dist) before `flyctl deploy`, because the
# sibling ../sdk checkout doesn't exist inside the Docker build context. A local
# `docker build` without that vendor step fails on the COPY below — expected.
#
# Runtime is a static server: `node web/serve.mjs` serves the prebuilt shells,
# injecting window.__GLYPHH_* config (from env — fly.toml [env]) + the SDK bridge
# into HTML. No web/.env in the image; process.env wins in serve.mjs.

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /work/app

# Rewire the lockfile's `@glyphh/sdk: file:../sdk` link — placed at /work/sdk so
# the relative path resolves exactly as it does on a dev machine.
COPY .sdk-vendor/package.json /work/sdk/package.json
COPY .sdk-vendor/dist /work/sdk/dist

COPY package.json package-lock.json ./
# --ignore-scripts: skips the electron-rebuild postinstall (native desktop-only
# toolchain). esbuild/tsc/shx need no install scripts; esbuild's linux binary
# arrives via optionalDependencies.
RUN npm ci --ignore-scripts

COPY . .
# Which shells this image carries. build:web = the desktop renderer's web shell
# (command center + login + platform, the bridge, monaco, xterm, the app libs)
# PLUS the mobile bundle, brand art and fonts; build:mobile = the mobile bundle
# only. fly.toml / fly.mobile.toml pass it under [build.args].
ARG BUILD_SCRIPT=build:web
RUN npm run "$BUILD_SCRIPT"

# ── run ───────────────────────────────────────────────────────────────────────
# Lean: only serve.mjs + the built renderer. serve.mjs resolves ../dist/renderer
# relative to web/, so the /app/web + /app/dist/renderer layout is load-bearing.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3002

COPY --from=build /work/app/web/serve.mjs ./web/serve.mjs
COPY --from=build /work/app/web/serve-routes.mjs ./web/serve-routes.mjs
COPY --from=build /work/app/web/webicon.mjs ./web/webicon.mjs
COPY --from=build /work/app/dist/renderer ./dist/renderer

EXPOSE 3002
USER node
CMD ["node", "web/serve.mjs"]

# hugmesh-mastodon-ui — builds the Mastodon native-federation REMOTE
# (src → dist/mastodon/browser) and serves it via nginx with CORS so the
# hugmesh.net host can fetch its remoteEntry.json cross-origin.
# Deployed to the hugmesh-frontend namespace, fronted by the fe-gateway at
# /social/mastodon.
# Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# --base-href is REQUIRED: this UI is served under /social/mastodon/ behind the
# fe-gateway. Without it Angular emits root-relative asset URLs, so a direct
# load of /social/mastodon/ fetches /styles-*.css from the gateway ROOT, gets
# the shell's HTML back, and the remote renders BLANK (MIME-type refusal).
# It renders only when opened at the container's own address — exactly the
# operator report of 2026-08-14. Was carried as an UNCOMMITTED local edit in
# the generator's .stack-src tree; committed here so a clean clone works.
RUN npm run build:mastodon -- --base-href=/social/mastodon/

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/mastodon/browser /usr/share/nginx/html
EXPOSE 80

#### Runtime THEME injection (the fleet-wide login-ui 50-snap-theme.sh
#### mechanism; see hugmesh-host-shell PR #11 for the full rationale). The hook
#### writes $SNAP_THEME_CSS verbatim at container start; nginx serves it via
#### the exact-match /snap-theme.css alias. /tmp, NOT the docroot: on the
#### nginx-unprivileged images uid 101 cannot write the docroot, and on the
#### root images /tmp is equally correct — ONE stanza for the whole fleet.
#### COPY --chmod, NOT COPY + RUN chmod: unprivileged final stages run as
#### uid 101 and a RUN chmod on root-owned COPY output exits 1 (BuildKit is
#### always on for this stack: Makefile DOCKER_BUILDKIT=1).
COPY --chmod=0755 docker-entrypoint.d/50-snap-theme.sh /docker-entrypoint.d/50-snap-theme.sh
ENV SNAP_THEME_OUT=/tmp/snap-theme.css

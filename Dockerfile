# hugmesh-mastodon-ui — builds the Mastodon native-federation REMOTE
# (src → dist/mastodon/browser) and serves it via nginx with CORS so the
# hugmesh.systems host can fetch its remoteEntry.json cross-origin.
# Deployed to the snapdragon-frontend namespace, fronted by the fe-gateway at
# /social/mastodon.
# Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:mastodon

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/mastodon/browser /usr/share/nginx/html
EXPOSE 80

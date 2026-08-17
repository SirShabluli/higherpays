# HigherPays backend — slim Node 22 image on Alpine.
#
# The container waits for Postgres, runs migrations as `postgres` (superuser),
# then boots the server as the restricted `hp_app` role (see entrypoint.sh).
FROM node:22-alpine

WORKDIR /app

# `postgresql-client` gives us pg_isready + psql for the entrypoint script.
# `tini` is a tiny init that reaps zombies and forwards signals cleanly.
RUN apk add --no-cache postgresql-client tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "sh", "/app/entrypoint.sh"]

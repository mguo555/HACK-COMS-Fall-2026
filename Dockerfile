# TheDailyStalk: the built site and the API server in one image. In production it runs with
# Postgres via compose.yaml (scripts/deploy.sh). Photos live in /data, so mount a folder there.
# Settings come from the environment (see .env.example).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npx -y npm@11 ci --no-audit --no-fund
COPY . .
RUN npx ng build

FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npx -y npm@11 ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm
COPY tsconfig.json ./
COPY server ./server
COPY src/app/shared ./src/app/shared
COPY scripts/import-sqlite.ts ./scripts/
COPY --from=build /app/dist/daily-stalk/browser ./dist/daily-stalk/browser
ENV HOST=0.0.0.0 PORT=3001 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/main.ts"]

# TheDailyStalk: the built site and the API server in one image.
#
#   docker build -t thedailystalk .
#   docker run -d --init -p 5001:3001 -v ~/thedailystalk/data:/data --env-file .env thedailystalk
#
# The database and photos live in /data, so mount a folder there or they vanish with the
# container. Settings come from the environment (see .env.example). scripts/deploy.sh does all
# of this on a remote server.

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
COPY --from=build /app/dist/daily-stalk/browser ./dist/daily-stalk/browser
ENV HOST=0.0.0.0 PORT=3001 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/main.ts"]

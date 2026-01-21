FROM node:22-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

# hadolint ignore=DL3008
RUN apt-get update && \
  apt-get install -y --no-install-recommends tzdata ca-certificates && \
  cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
  echo "Asia/Tokyo" > /etc/timezone && \
  rm -rf /var/lib/apt/lists/* && \
  npm install -g corepack@latest && \
  corepack enable

WORKDIR /app

RUN pnpm config set node-linker hoisted

COPY pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

COPY package.json tsconfig.json .npmrc ./
COPY src src
COPY entrypoint.sh ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV CONFIG_PATH=/data/config.json
ENV OUTPUT_DIR=/data
ENV COOKIE_CACHE_PATH=/data/twitter-cookies.json

ENTRYPOINT [ "/app/entrypoint.sh" ]

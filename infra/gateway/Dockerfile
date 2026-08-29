FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY types ./types
COPY tsconfig.json tsconfig.worker.json ./
RUN pnpm exec tsc --project tsconfig.worker.json

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin threadbeacon

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
    && corepack prepare pnpm@10.13.1 --activate \
    && pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
RUN chown -R threadbeacon:threadbeacon /app

USER threadbeacon
EXPOSE 8789
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/gateway.js"]

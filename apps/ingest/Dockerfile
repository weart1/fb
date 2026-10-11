FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@weart/ingest..." --filter "@weart/sdk..." \
 && pnpm --filter @weart/sdk build
ENV NODE_ENV=production INGEST_PORT=4318
EXPOSE 4318
CMD ["node", "--import", "tsx", "apps/ingest/src/main.ts"]

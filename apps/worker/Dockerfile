FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@weart/worker..."
ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "apps/worker/src/main.ts"]

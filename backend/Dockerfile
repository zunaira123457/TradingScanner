# Trading Desk scanner API (read-only; never places orders).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production TS_NODE_TRANSPILE_ONLY=1 SCANNER_PORT=4000
# Seed data: paper-trading log and (if present locally) the price cache, so the
# first scan doesn't have to re-download everything at 8 req/min.
COPY data ./data
RUN useradd --system --create-home app && mkdir -p /app/data/cache && chown -R app:app /app/data
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "-r", "ts-node/register", "-r", "tsconfig-paths/register", "src/server/index.ts"]

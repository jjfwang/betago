FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/app/data/db.sqlite3

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY db ./db
COPY knexfile.cjs ./
COPY public ./public
COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/data \
  && chmod +x /app/docker-entrypoint.sh \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]

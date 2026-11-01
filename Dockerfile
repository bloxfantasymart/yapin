FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY docs ./docs
COPY .env.example LICENSE README.md ./

RUN mkdir -p /app/data && chown -R node:node /app/data

# Run as non-root node user with persistent /app/data volume for JSON storage
USER node

VOLUME ["/app/data"]
EXPOSE 3100 3200

CMD ["node", "src/index.js"]

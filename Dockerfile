FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY docs ./docs
COPY .env.example LICENSE README.md ./

# Run as non-root node user
USER node

EXPOSE 3100 3200

CMD ["node", "src/index.js"]

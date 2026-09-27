FROM registry.access.redhat.com/hi/nodejs:26-builder AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN npm run build

# Pre-download ML models to cache them in the image
RUN node -e "import('@xenova/transformers').then(async m => { \
  const { pipeline, env } = m; \
  env.cacheDir = '/tmp/transformers-cache'; \
  console.log('Downloading embedding model...'); \
  await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); \
  console.log('Downloading sentiment model...'); \
  await pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english'); \
  console.log('Models cached successfully'); \
})"

RUN mkdir -p /app/.transformers-cache && \
    cp -r /tmp/transformers-cache/* /app/.transformers-cache/ || true

FROM registry.access.redhat.com/hi/nodejs:26

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/data ./data
COPY --from=builder /app/.transformers-cache ./.transformers-cache
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./

EXPOSE 8080
ENV PORT=8080 NODE_ENV=production MODEL_CACHE_PATH=/app/.transformers-cache

CMD ["node", "dist/server.js"]

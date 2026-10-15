FROM node:22.9.0-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.9.0-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` directly: the npm "build" script ends in `|| true`, which would hide a failed build
RUN npx next build

# output: "standalone" puts a minimal server.js plus only the runtime dependencies in .next/standalone,
# so the image needs neither node_modules nor the build cache
FROM node:22.9.0-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

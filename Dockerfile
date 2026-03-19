FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

# --- Production image ---
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist dist/
COPY src/public/ dist/public/

ENV NODE_ENV=production
ENV PORT=3402

EXPOSE 3402

CMD ["node", "dist/server.js"]

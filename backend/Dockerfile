# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Prisma needs openssl at runtime; curl helpful for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
# Azure App Service maps PORT -> this; keep listening on $PORT
CMD ["./entrypoint.sh"]

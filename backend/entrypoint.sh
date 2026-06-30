#!/bin/sh
set -e

# Sync the Prisma schema to the live DB on every boot (idempotent).
# Safe for a demo deploy; for long-lived prod prefer `prisma migrate`.
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Running prisma db push ..."
  npx prisma db push --skip-generate || echo "[entrypoint] prisma db push failed — continuing"
fi

echo "[entrypoint] Starting NestJS on port ${PORT:-3000}"
exec node dist/main.js

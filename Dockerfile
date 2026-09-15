FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN BETTER_AUTH_SECRET=build-only-placeholder-never-used-at-runtime-0123456789 npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/trip-planner.sqlite
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node scripts/docker-entrypoint.mjs ./docker-entrypoint.mjs
COPY --chown=node:node scripts/reset-password.mjs ./scripts/reset-password.mjs
# The admin CLI runs outside Next.js, so its password helper is not traced.
COPY --from=build --chown=node:node /app/node_modules/@better-auth/utils ./node_modules/@better-auth/utils
COPY --chown=node:node licenses ./licenses
COPY --chown=node:node THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "docker-entrypoint.mjs"]

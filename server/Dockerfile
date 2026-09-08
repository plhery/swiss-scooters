FROM node:24-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY data ./data
COPY src ./src
COPY server ./server
RUN ./node_modules/.bin/esbuild server/scooter-cache.ts --bundle --platform=node --format=esm --target=node24 --outfile=cache.mjs

FROM node:24-alpine
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build /app/cache.mjs ./cache.mjs
USER node
ENV NODE_ENV=production PORT=3001 SCOOTER_SNAPSHOT_PATH=/data/scooters.json
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "cache.mjs"]

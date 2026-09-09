FROM m.daocloud.io/docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM m.daocloud.io/docker.io/library/node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/config ./config
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

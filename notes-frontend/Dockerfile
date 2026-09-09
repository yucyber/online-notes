FROM m.daocloud.io/docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_YWS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_YWS_URL=$NEXT_PUBLIC_YWS_URL
ENV SERVER_API_URL=http://backend:3001/api DOCKER_BUILD=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM m.daocloud.io/docker.io/library/node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

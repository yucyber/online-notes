# Multi-stage build to emulate Zeabur/managed container platforms
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Ensure devDependencies are installed even if platform sets production flags
ENV npm_config_production=false
# Install full deps for build (includes TypeScript)
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# Install production deps only
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0
CMD ["node","dist/main.js"]

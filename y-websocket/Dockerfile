FROM m.daocloud.io/docker.io/library/node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.js ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=1234
USER node
EXPOSE 1234
CMD ["node", "start.js"]

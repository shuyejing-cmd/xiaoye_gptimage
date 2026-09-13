FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "src/gateway/index.mjs"]
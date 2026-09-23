FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web ./web
RUN npm run web:build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/data /app/web/dist/downloads && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "src/platform/index.mjs"]

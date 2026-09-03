# Build and run the hosted KRÉTA MCP server on Cloud Run.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Cloud Run sets PORT; the default matches its own default.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]

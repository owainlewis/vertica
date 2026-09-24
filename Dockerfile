FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
# The API shares its validation and media rules with the browser. Copy every
# plain .ts module rather than a hand-kept list, which has drifted before.
COPY app/*.ts ./app/
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "server/index.ts"]

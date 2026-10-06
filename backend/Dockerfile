FROM node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY shared/package.json shared/
COPY shared/*.js shared/

RUN npm ci --omit=dev --workspace=backend --workspace=shared

COPY backend/ backend/

WORKDIR /app/backend

EXPOSE 3005

CMD ["node", "src/server.js"]

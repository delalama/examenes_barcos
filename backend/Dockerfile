FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci
COPY config ./config
COPY backend ./backend
COPY frontend ./frontend
RUN npx prisma generate --schema backend/prisma/schema.prisma && npm run build --workspace backend
EXPOSE 4000
CMD ["npm","run","start","--workspace","backend"]

FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm install
COPY config ./config
COPY backend ./backend
COPY frontend ./frontend
RUN npx prisma generate --schema backend/prisma/schema.prisma && npm run build --workspace backend
EXPOSE 4000
CMD ["npm","run","start","--workspace","backend"]

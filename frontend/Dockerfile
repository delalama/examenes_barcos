FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm install
COPY backend ./backend
COPY frontend ./frontend
ARG VITE_API_URL=http://localhost:4000/api
RUN VITE_API_URL=$VITE_API_URL npm run build --workspace frontend
FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80

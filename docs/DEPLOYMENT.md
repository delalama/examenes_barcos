# Despliegue

## Local
Configura `.env`, luego `docker compose up --build` y aplica `npm run db:migrate`.

## Render
`render.yaml` es la base. Configura `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN` y almacenamiento persistente.

## GitHub Pages
Compila `VITE_BASE=/repo/ VITE_API_URL=https://api.example npm run build --workspace frontend`, publica `frontend/dist`. HashRouter admite refresco de rutas. Nunca incluyas secretos en `VITE_`.

## Fly.io
Configura `DATABASE_URL` como secreto y crea PostgreSQL administrado antes de desplegar con `fly deploy`; aplica `prisma migrate deploy` durante release.

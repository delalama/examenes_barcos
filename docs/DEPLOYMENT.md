# Despliegue

## Local
Configura `.env`, luego `docker compose up --build` y aplica `npm run db:migrate`.

## Render

The root `render.yaml` defines the API, the static frontend, and a PostgreSQL database in Frankfurt. Connect the GitHub repository to Render and create a Blueprint from this file.

During setup, provide the public URLs for the two services:

- `VITE_API_URL`: `https://<api-host>/api`
- `FRONTEND_ORIGIN`: `https://<frontend-host>`

The API starts with `NODE_ENV=production`, generates `JWT_SECRET`, and runs `prisma migrate deploy` when it starts. Create the first administrator in the API service shell:

```powershell
npm run admin --workspace backend -- --email admin@example.com --password "<12-or-more-characters>"
```

`DB_INIT_STATE` is a local-only backup and is excluded from Git. To seed the Render database, restore `DB_INIT_STATE/nautical-init.dump` using the local restore script and the database external connection URL. The restore replaces matching database objects and includes local accounts and attempt history.

Question images are stored as PostgreSQL `BYTEA` data and included in the database dump. Before exporting the snapshot, run `npm run db:import-question-images --workspace backend` to copy local question image files into PostgreSQL. Render does not need a persistent disk. The OCR review page is enabled in local builds and disabled in the Render frontend; keep PDFs and OCR staging files local for preparing future exams.

## GitHub Pages
Compila `VITE_BASE=/repo/ VITE_API_URL=https://api.example npm run build --workspace frontend`, publica `frontend/dist`. HashRouter admite refresco de rutas. Nunca incluyas secretos en `VITE_`.

## Fly.io
Configura `DATABASE_URL` como secreto y crea PostgreSQL administrado antes de desplegar con `fly deploy`; aplica `prisma migrate deploy` durante release.

# Despliegue

## Local
Configura `.env`, luego `docker compose up --build` y aplica `npm run db:migrate`.

## Render + Supabase

The root `render.yaml` creates only the API and static frontend on Render. It does not create a Render Postgres database. During Blueprint setup, enter `DATABASE_URL` from Supabase, plus the public service URLs:

- `DATABASE_URL`: Supabase Postgres connection string. For the long-running Render API, use Supabase's **Session pooler** connection string (port 5432), copied from the Supabase Connect dialog. Do not use the transaction pooler (port 6543) for this Prisma server.
- `VITE_API_URL`: `https://<api-host>/api`
- `FRONTEND_ORIGIN`: `https://<frontend-host>`

Create the Supabase project in an EU region, then restore `DB_INIT_STATE/nautical-init.dump` with `DB_INIT_STATE/db-init-state.ps1 -Action Restore`. Use Supabase's direct database connection for the restore when your local network supports IPv6; otherwise use its Session pooler connection. The dump includes local user accounts, attempt history, and question image bytes.

The API runs `prisma migrate deploy` on startup. Render serves the static frontend for free; its free API service sleeps after 15 minutes without traffic and may take about a minute to wake. Supabase Free currently includes 500 MB per database and may pause a project after seven days with too little activity. These free tiers are suitable for trying the deployment, with those availability limits.

Create the first administrator only if no admin account was restored:

```powershell
npm run admin --workspace backend -- --email admin@example.com --password "<12-or-more-characters>"
```

`DB_INIT_STATE` is local-only and excluded from Git. Question images are stored in PostgreSQL; PDFs and OCR staging files stay local and are not needed by the deployed practice app. The OCR review page and API routes are disabled in Render.

## GitHub Pages
Compila `VITE_BASE=/repo/ VITE_API_URL=https://api.example npm run build --workspace frontend`, publica `frontend/dist`. HashRouter admite refresco de rutas. Nunca incluyas secretos en `VITE_`.

## Fly.io
Configura `DATABASE_URL` como secreto y crea PostgreSQL administrado antes de desplegar con `fly deploy`; aplica `prisma migrate deploy` durante release.

# Práctica Exámenes PNB/PER/PY/CY

- Proyecto: [webs](https://github.com/delalama/webs)
- Aplicación: [nautical-exams-web.onrender.com](https://nautical-exams-web.onrender.com/)

Monorepo con React/Vite, API Express/TypeScript, PostgreSQL/Prisma e importador Python independiente.

## Inicio local
1. Copia `.env.example` a `.env` y establece un `JWT_SECRET` aleatorio de 32+ caracteres.
2. `docker compose up -d db`
3. `npm install`
4. `npm run db:migrate`
5. `npm run dev` (API http://localhost:4000, web http://localhost:5173).
6. Crea administrador: `npm run admin -- --email admin@example.com --password 'cambia-esto-seguro'`.

El registro abierto solo se habilita fuera de producción. En despliegue limita la activación de cuentas a invitaciones.

## Importar PDFs
Copia exámenes a `exams/pdfs/` y ejecuta `python importer/import.py exams/pdfs --out importer/out`. Revisa el JSON; no se infieren soluciones ni se publican preguntas sin revisión.

Ver `docs/` para arquitectura, importación y despliegue. GitHub Pages usa HashRouter y `VITE_API_URL`/`VITE_BASE`.

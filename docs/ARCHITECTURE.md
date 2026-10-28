# Arquitectura

- `frontend`: React responsive y HashRouter, API URL configurada al compilar.
- `backend`: REST Express, validación Zod, Prisma/PostgreSQL, JWT y bcrypt.
- `importer`: extracción nativa PyMuPDF, contexto contiguo entre páginas y JSON para revisión. Sin respuesta generada por modelo.
- `config/app.config.ts`: opciones de negocio; secretos exclusivamente en el entorno.
- `storage`: almacenamiento local de desarrollo. En producción configure volumen persistente u objeto S3 antes de servir imágenes.

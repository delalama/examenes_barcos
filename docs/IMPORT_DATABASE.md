# Modelo de datos para preguntas importadas

## Flujo de publicación

1. **PDF original:** `SourceDocument` conserva ruta, nombre, tamaño y SHA-256. El hash único permite reconocer reenvíos del mismo archivo sin guardar el PDF como blob en PostgreSQL.
2. **Ejecución de extracción:** `ImportRun` conserva la versión del parser, estado, fechas, avisos y errores. Reprocesar un PDF crea otra ejecución auditable.
3. **Examen en borrador:** `Exam` guarda isla, titulación, año, convocatoria, modelo y referencia al documento y a la ejecución que lo creó.
4. **Preguntas pendientes:** `Question` guarda enunciado, opciones JSON, respuesta oficial si se encontró explícitamente, origen, páginas, texto extraído, coordenadas futuras, confianza y avisos. La importación nunca las marca validadas.
5. **Revisión humana:** solo al corregir metadatos/texto y confirmar la solución se marca `VALIDATED`; el examen pasa a `PUBLISHED` cuando está completo. La API de práctica consulta solo preguntas validadas de exámenes publicados.
6. **Intentos del alumno:** `Attempt` almacena respuestas y resultado por separado; el navegador no recibe respuestas oficiales antes de finalizar.

## Primera prueba del extractor

Se procesó un PDF real de `2017/diciembre`, 9 páginas. El extractor produjo 40 preguntas, 4 opciones y una respuesta explícita del PDF para cada pregunta. Todas quedaron `PENDING_REVIEW`. El JSON de la prueba se escribe bajo `importer/out/prueba-real/` (directorio ignorado por Git).

Comando de prueba acotada:

```powershell
python importer/import.py exams/pdfs/desorden/2017/diciembre --out importer/out/prueba-real --limit 1
```

## Implementación existente

El esquema Prisma define `SourceDocument`, `ImportRun`, `Exam` y `Question`, además de usuarios y sesiones. `backend/prisma/migrations/20261028000000_init/migration.sql` crea la estructura completa. `backend/src/import-staging.ts` carga los JSON en transacciones idempotentes; los exámenes quedan `DRAFT` y todas las preguntas `PENDING_REVIEW`.

## Análisis de colección

El analizador excluye cualquier PDF cuyo nombre contenga `MAREES`, agrupa por SHA-256 y escribe un JSON por documento único. No importa directamente a PostgreSQL:

```powershell
python importer/analyze_collection.py
```

La salida está en `importer/out/bulk-analysis/`: `documents/` contiene las preguntas extraídas; `summary.json` resume el lote; `review-queue.csv` lista preguntas con avisos o sin respuesta explícita; `metadata-review.csv` lista documentos con islas o titulaciones ambiguas; `excluded-marees.csv` deja constancia de los PDFs omitidos.

Cuando `DATABASE_URL` apunte a un PostgreSQL accesible y estén aplicadas las migraciones:

```powershell
npm run db:migrate --workspace backend
npm run db:import-staging --workspace backend
```

La carga de staging no publica preguntas. Para hacerlas visibles al estudiante sigue siendo necesaria la revisión administrativa.

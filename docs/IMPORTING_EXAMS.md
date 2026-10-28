# Importación

Coloca PDFs en `exams/pdfs` en cualquier jerarquía. `python importer/import.py exams/pdfs --out importer/out` extrae texto y reconoce metadatos sin distinguir mayúsculas. Metadatos desconocidos son null.

El análisis conserva páginas adyacentes. Toda pregunta queda inicialmente `PENDING_REVIEW`; preguntas incompletas o respuestas ambiguas no se publican. No se incluyen PDFs reales ni API visual. Para escaneos se requiere OCR local o un adaptador visual configurado.

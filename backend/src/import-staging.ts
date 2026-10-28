import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || "../.env" });
import { Prisma, PrismaClient } from "@prisma/client";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";

const db = new PrismaClient();
const STAGING = resolve(process.env.IMPORT_STAGING_DIR || "../importer/out/bulk-analysis/documents");
const CORRECTIONS = resolve(process.env.IMPORT_CORRECTIONS_FILE || "../importer/out/bulk-analysis/review-corrections.json");
const PARSER_VERSION = "pymupdf-text-v3-student-notice-for-confirmed-multiple-answers";
const optionSchema = z.record(z.string(), z.string());
const questionSchema = z.object({
  number: z.number().int(), prompt: z.string(), options: optionSchema,
  answer: z.string().nullable(), answerSource: z.string().nullable(),
  status: z.enum(["VALIDATED","PENDING_REVIEW","REJECTED"]).optional(), imagePath: z.string().nullable().optional(),
  confidence: z.number(), startPage: z.number().int().nullable(), endPage: z.number().int().nullable(),
  rawText: z.string().nullable().optional(), warnings: z.array(z.string()),
});
const documentSchema = z.object({
  sha256: z.string().length(64), source: z.string(), sourcePaths: z.array(z.string()).min(1),
  sizeBytes: z.number().int().nonnegative(), pages: z.number().int().nonnegative(),
  metadata: z.object({
    island: z.string().nullable().optional(), islands: z.array(z.string()).optional(),
    license: z.string().nullable().optional(), licenses: z.array(z.string()).optional(),
    year: z.number().int().nullable().optional(), session: z.string().nullable().optional(),
    model: z.string().nullable().optional(), warnings: z.array(z.string()).optional(),
  }).passthrough(),
  questions: z.array(questionSchema),
});

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsonFiles(path) : path.endsWith(".json") ? [path] : [];
  }).sort();
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada");
  if (!statSync(STAGING, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No existe staging: ${STAGING}`);
  const files = jsonFiles(STAGING);
  const corrections = existsSync(CORRECTIONS) ? JSON.parse(readFileSync(CORRECTIONS, "utf8")) as Record<string,Record<string,{prompt?:string;options?:Record<string,string>;answer?:string|null;status?:"VALIDATED"|"PENDING_REVIEW"|"REJECTED";imagePath?:string;imageReviewStatus?:"PENDING_REVIEW"|"ATTACHED"|"NOT_REQUIRED"}>> : {};
  let inserted = 0, skipped = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const document = documentSchema.parse(raw);
    const existing = await db.sourceDocument.findUnique({ where: { sha256: document.sha256 } });
    if (existing) {
      const previousRun = await db.importRun.findFirst({ where: { sourceDocumentId: existing.id, parserVersion: PARSER_VERSION } });
      if (previousRun) { skipped++; continue; }
    }
    await db.$transaction(async (tx) => {
      const source = await tx.sourceDocument.upsert({
        where: { sha256: document.sha256 },
        create: { sha256: document.sha256, originalName: document.source, sourcePath: document.sourcePaths[0],
          sizeBytes: document.sizeBytes, pageCount: document.pages },
        update: { originalName: document.source, sourcePath: document.sourcePaths[0],
          sizeBytes: document.sizeBytes, pageCount: document.pages },
      });
      const warnings = {
        sourcePaths: document.sourcePaths,
        metadata: document.metadata,
        stagingFile: relative(process.cwd(), file),
        note: "Importación en staging; requiere revisión antes de publicar.",
      } as Prisma.InputJsonValue;
      const run = await tx.importRun.create({ data: {
        sourceDocumentId: source.id, parserVersion: PARSER_VERSION, status: "PENDING_REVIEW",
        extractedAt: new Date(), warnings,
      } });
      const licenseCandidates = document.metadata.licenses || (document.metadata.license ? [document.metadata.license] : []);
      const exam = await tx.exam.create({ data: {
        title: document.source, license: licenseCandidates.length === 1 ? licenseCandidates[0] : "PENDING_REVIEW",
        island: document.metadata.islands?.length === 1 ? document.metadata.islands[0] : document.metadata.island || null,
        year: document.metadata.year || null, session: document.metadata.session || null,
        model: document.metadata.model || null, status: "PUBLISHED", sourcePdf: document.sourcePaths[0],
        sourceDocumentId: source.id, importRunId: run.id,
      } });
      if (document.questions.length) await tx.question.createMany({ data: document.questions.map((q) => {
        const correction = corrections[document.sha256]?.[String(q.number)];
        const imagePath = correction?.imageReviewStatus === "NOT_REQUIRED" ? null : correction?.imagePath ?? q.imagePath ?? null;
        if (imagePath) {
          if (!/^[a-f0-9]{64}-\d+(?:-auto)?\.png$/.test(imagePath)) throw new Error(`Ruta de imagen no válida: ${imagePath}`);
          const sourceImage = join(STAGING, "..", "images", imagePath), targetDir = resolve(process.cwd(), "../storage/question-images"), targetImage = join(targetDir, imagePath);
          if (existsSync(sourceImage) && !existsSync(targetImage)) { mkdirSync(targetDir,{recursive:true}); copyFileSync(sourceImage,targetImage); }
          if (!existsSync(targetImage)) throw new Error(`Falta el archivo de imagen ${imagePath}`);
        }
        return {
        examId: exam.id, number: q.number, prompt: correction?.prompt ?? q.prompt, options: (correction?.options ?? q.options) as Prisma.InputJsonValue,
        answer: correction && Object.hasOwn(correction,"answer") ? correction.answer! : q.answer, answerSource: correction && Object.hasOwn(correction,"answer") ? "HUMAN_REVIEW" : q.answerSource, confidence: q.confidence,
        status: correction?.status ?? q.status ?? "PENDING_REVIEW", startPage: q.startPage, endPage: q.endPage, imagePath,
        rawText: q.rawText || null, warnings: q.warnings,
      }}) });
    }, { maxWait: 10000, timeout: 60000 });
    inserted++;
    if (inserted % 25 === 0 || inserted + skipped === files.length) console.log(`Importados ${inserted}; omitidos ${skipped}; total ${files.length}`);
  }
  console.log(JSON.stringify({ stagingDocuments: files.length, inserted, skipped, published: 0 }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });

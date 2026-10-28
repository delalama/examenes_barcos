import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || "../.env" });
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const db = new PrismaClient();
const imageRoots = [
  resolve(process.env.QUESTION_IMAGE_ROOT || "../storage/question-images"),
  resolve(process.env.IMPORT_OUT_ROOT || "../importer/out", "bulk-analysis/images"),
];

async function main() {
  const questions = await db.question.findMany({
    where: { imagePath: { not: null } },
    select: { id: true, imagePath: true },
  });
  let imported = 0;
  const missing: string[] = [];

  for (const question of questions) {
    const filename = question.imagePath;
    if (!filename || !/^[a-f0-9]{64}-\d+(?:-auto)?\.png$/.test(filename)) {
      missing.push(`${question.id}: ruta de imagen no válida`);
      continue;
    }
    const imageFile = imageRoots.map((root) => join(root, filename)).find(existsSync);
    if (!imageFile) {
      missing.push(`${question.id}: ${filename} is missing`);
      continue;
    }
    await db.question.update({
      where: { id: question.id },
      data: { imageData: readFileSync(imageFile) },
    });
    imported++;
  }

  console.log(`Imágenes guardadas en PostgreSQL: ${imported}/${questions.length}`);
  if (missing.length) {
    console.error("Preguntas con imágenes que no se pudieron importar:");
    for (const item of missing) console.error(`- ${item}`);
    process.exitCode = 1;
  }
}

main().finally(() => db.$disconnect());

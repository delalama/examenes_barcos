import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || "../.env" });
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { grade } from "./grading";

const app=express(), db=new PrismaClient(), port=Number(process.env.PORT||4000), secret=process.env.JWT_SECRET||"dev-only-change-me-32-characters";
const storageRoot=resolve(process.env.STORAGE_ROOT||"../storage"), importerOutRoot=resolve(process.env.IMPORT_OUT_ROOT||"../importer/out");
const stagingDir=resolve(process.env.STAGING_DIR||join(importerOutRoot,"bulk-analysis/documents")), correctionsFile=resolve(process.env.CORRECTIONS_FILE||join(importerOutRoot,"bulk-analysis/review-corrections.json")), pdfRoot=resolve(process.env.PDF_ROOT||"../exams/pdfs");
app.use(cors({origin:process.env.FRONTEND_ORIGIN?.split(",")||true})); app.use(express.json({limit:"1mb"}));
const authLimit=rateLimit({windowMs:900000,limit:10,standardHeaders:true,legacyHeaders:false,handler:(_req,res)=>res.status(429).json({error:"Demasiados intentos de acceso desde esta conexión. Espera 15 minutos y vuelve a intentarlo."})});
app.get("/api/health",(_req,res)=>res.json({ok:true}));
function auth(req:any,res:any,next:any){try{const token=req.headers.authorization?.replace(/^Bearer /,"");req.user=jwt.verify(token,secret);next()}catch{return res.status(401).json({error:"Autenticación requerida"})}}
function admin(req:any,res:any,next:any){if(req.user?.role!=="ADMIN")return res.status(403).json({error:"Permiso insuficiente"});next()}
function ocrAdmin(req:any,res:any,next:any){if(process.env.OCR_REVIEW_ENABLED==="false")return res.status(404).json({error:"Revisi?n OCR deshabilitada en este entorno"});admin(req,res,next)}
function isProbableAnswerError(warnings:string[]):boolean{return warnings.some((warning)=>warning.includes("probablemente errónea"))}
function officialAnswerCandidates(_answerSource:string|null,warnings:string[]):string[]{const value=warnings.find((warning)=>warning.startsWith("El PDF indica varias respuestas ("));const match=value?.match(/\(([A-D](?:, [A-D])*)\)/);return match?match[1].split(", "):[]}
app.post("/api/auth/register",authLimit,async(req,res)=>{try{const v=z.object({email:z.string().email(),password:z.string().min(10),name:z.string().min(1)}).parse(req.body);if(process.env.NODE_ENV==="production")return res.status(403).json({error:"Registro público deshabilitado"});const user=await db.user.create({data:{...v,passwordHash:await bcrypt.hash(v.password,12)},select:{id:true,email:true,name:true,role:true}});res.status(201).json(user)}catch(e:any){res.status(400).json({error:e.message})}});
app.post("/api/auth/login",authLimit,async(req,res)=>{const v=z.object({email:z.string().email(),password:z.string()}).safeParse(req.body);if(!v.success)return res.status(400).json({error:"Datos no válidos"});const u=await db.user.findUnique({where:{email:v.data.email}});if(!u||!u.active||!await bcrypt.compare(v.data.password,u.passwordHash))return res.status(401).json({error:"Credenciales incorrectas"});res.json({token:jwt.sign({id:u.id,role:u.role},secret,{expiresIn:"12h"}),user:{id:u.id,email:u.email,name:u.name,role:u.role}})});
app.get("/api/auth/me",auth,async(req:any,res)=>res.json(await db.user.findUnique({where:{id:req.user.id},select:{id:true,email:true,name:true,role:true,preferences:true}})));
app.get("/api/users/me/preferences",auth,async(req:any,res)=>res.json(await db.preference.findUnique({where:{userId:req.user.id}})));
app.patch("/api/users/me/preferences",auth,async(req:any,res)=>{const v=z.object({licenses:z.array(z.enum(["PNB","PER","PY","CY"])).optional(),islands:z.array(z.enum(["Mallorca","Menorca","Ibiza"])).optional(),theme:z.enum(["LIGHT","DARK"]).optional()}).parse(req.body);res.json(await db.preference.upsert({where:{userId:req.user.id},create:{userId:req.user.id,licenses:v.licenses??[],islands:v.islands??[],theme:v.theme??"LIGHT"},update:v}))});
app.get("/api/review-block",auth,async(req:any,res)=>{const items=await db.reviewBlockItem.findMany({where:{userId:req.user.id},orderBy:[{masteredAt:"asc"},{createdAt:"desc"}],include:{question:{select:{id:true,number:true,prompt:true,options:true,answer:true,answerSource:true,warnings:true,exam:{select:{id:true,title:true,license:true,island:true,year:true,session:true}}}}}});const mastered=items.filter((item)=>item.masteredAt).length;res.json({items:items.map((item)=>({...item,probableAnswerError:isProbableAnswerError(item.question.warnings),officialAnswerCandidates:officialAnswerCandidates(item.question.answerSource,item.question.warnings)})),total:items.length,active:items.length-mastered,mastered,progress:items.length?Math.round(100*mastered/items.length):0})});
app.post("/api/review-block/:questionId",auth,async(req:any,res)=>{const question=await db.question.findFirst({where:{id:req.params.questionId,status:"VALIDATED",exam:{status:"PUBLISHED"}},select:{id:true}});if(!question)return res.status(404).json({error:"Pregunta no disponible para repaso"});const item=await db.reviewBlockItem.upsert({where:{userId_questionId:{userId:req.user.id,questionId:question.id}},create:{userId:req.user.id,questionId:question.id},update:{masteredAt:null}});res.status(201).json(item)});
app.patch("/api/review-block/:questionId",auth,async(req:any,res)=>{const v=z.object({mastered:z.boolean()}).safeParse(req.body);if(!v.success)return res.status(400).json({error:"Estado de repaso no v?lido"});const result=await db.reviewBlockItem.updateMany({where:{userId:req.user.id,questionId:req.params.questionId},data:{masteredAt:v.data.mastered?new Date():null}});if(!result.count)return res.status(404).json({error:"La pregunta no est? en tu bloque de repaso"});res.json({ok:true,mastered:v.data.mastered})});
app.delete("/api/review-block/:questionId",auth,async(req:any,res)=>{await db.reviewBlockItem.deleteMany({where:{userId:req.user.id,questionId:req.params.questionId}});res.json({ok:true})});
app.get("/api/exams",auth,async(req,res)=>{const exams=await db.exam.findMany({where:{status:"PUBLISHED",...(req.query.license?{license:String(req.query.license)}:{})},select:{id:true,title:true,license:true,island:true,year:true,session:true,model:true}});const unresolved=exams.length?await db.question.findMany({where:{examId:{in:exams.map((exam)=>exam.id)},OR:[{status:"PENDING_REVIEW"},{warnings:{isEmpty:false}}]},select:{examId:true}}):[];const counts=new Map<string,number>();for(const question of unresolved)counts.set(question.examId,(counts.get(question.examId)||0)+1);res.json(exams.map((exam)=>({...exam,pendingReviewCount:counts.get(exam.id)||0})))});
app.get("/api/exams/:id",auth,async(req,res)=>{const e=await db.exam.findFirst({where:{id:req.params.id,status:"PUBLISHED"},select:{id:true,title:true,license:true,island:true,year:true,session:true,model:true}});e?res.json(e):res.status(404).json({error:"Examen no encontrado"})});
app.post("/api/attempts",auth,async(req:any,res)=>{
 try {
  const v=z.object({examId:z.string().optional(),license:z.enum(["PNB","PER","PY","CY"]).optional(),kind:z.enum(["OFFICIAL","RANDOM","ONE_BY_ONE","ROUND","REVIEW_BLOCK"]).default("OFFICIAL"),questionCount:z.number().int().min(1).max(100).default(10),reviewBlockOnly:z.boolean().default(false),withImage:z.boolean().default(false)}).parse(req.body);
  const eligible={OR:[{status:"VALIDATED" as const},{answerSource:"OFFICIAL_PDF_MULTIPLE"}]};
  let examId:string|undefined=v.examId, ids:string[]=[];
  if(v.examId){const exam=await db.exam.findFirst({where:{id:v.examId,status:"PUBLISHED"},include:{questions:{where:eligible,select:{id:true}}}});if(!exam)return res.status(404).json({error:"Examen no encontrado"});ids=exam.questions.map(q=>q.id)}
  else if(v.kind==="REVIEW_BLOCK"||v.reviewBlockOnly){
   const saved=await db.reviewBlockItem.findMany({where:{userId:req.user.id,masteredAt:null,question:{status:"VALIDATED",exam:{status:"PUBLISHED"}}},select:{questionId:true}});
   ids=saved.map(item=>item.questionId).sort(()=>Math.random()-.5).slice(0,v.questionCount);
   if(!ids.length)return res.status(409).json({error:"No tienes preguntas activas en tu bloque de repaso"});
  } else if(v.kind==="RANDOM"||v.kind==="ONE_BY_ONE"||v.kind==="ROUND"){
   const count=v.kind==="ONE_BY_ONE"?1:v.questionCount;
   const rows=v.license
    ?await db.$queryRaw<Array<{id:string}>>`SELECT q."id" FROM "Question" q JOIN "Exam" e ON e."id"=q."examId" WHERE e."status"='PUBLISHED'::"ExamStatus" AND e."license"=${v.license} AND q."status"='VALIDATED'::"QuestionStatus" AND (${v.withImage}=false OR (q."imagePath" IS NOT NULL AND q."imageData" IS NOT NULL)) ORDER BY RANDOM() LIMIT ${count}`
    :await db.$queryRaw<Array<{id:string}>>`SELECT q."id" FROM "Question" q JOIN "Exam" e ON e."id"=q."examId" WHERE e."status"='PUBLISHED'::"ExamStatus" AND q."status"='VALIDATED'::"QuestionStatus" AND (${v.withImage}=false OR (q."imagePath" IS NOT NULL AND q."imageData" IS NOT NULL)) ORDER BY RANDOM() LIMIT ${count}`;
   ids=rows.map(row=>row.id);
  } else return res.status(400).json({error:"Selecciona un examen, pr?ctica aleatoria o bloque de repaso"});
  if(!ids.length)return res.status(409).json({error:v.withImage?"No hay preguntas con imagen disponibles para esta titulaci?n":"No hay preguntas disponibles para esta selecci?n"});
  const attempt=await db.attempt.create({data:{userId:req.user.id,examId,kind:v.kind,questionIds:ids}});
  const found=await db.question.findMany({where:{id:{in:ids}},select:{id:true,number:true,prompt:true,options:true,imagePath:true,answerSource:true,warnings:true}});
  const byId=new Map(found.map(question=>[question.id,question]));
  const questions=ids.flatMap(id=>{const q=byId.get(id);return q?[{...q,probableAnswerError:isProbableAnswerError(q.warnings),officialAnswerCandidates:officialAnswerCandidates(q.answerSource,q.warnings)}]:[]});
  res.status(201).json({attemptId:attempt.id,questions});
 }catch(e:any){res.status(400).json({error:e.message})}
});
app.patch("/api/attempts/:id/answers",auth,async(req:any,res)=>{const v=z.record(z.string(),z.string()).safeParse(req.body.answers);if(!v.success)return res.status(400).json({error:"Respuestas no válidas"});const a=await db.attempt.findFirst({where:{id:req.params.id,userId:req.user.id,status:"IN_PROGRESS"}});if(!a)return res.status(404).json({error:"Intento no disponible"});const answers={...(a.answers as object),...v.data};res.json(await db.attempt.update({where:{id:a.id},data:{answers}}))});
app.post("/api/attempts/:id/finish",auth,async(req:any,res)=>{
 const a=await db.attempt.findFirst({where:{id:req.params.id,userId:req.user.id,status:"IN_PROGRESS"}});
 if(!a)return res.status(404).json({error:"Intento no disponible"});
 const answers=a.answers as Record<string,string>;
 const qs=await db.question.findMany({where:{id:{in:a.questionIds as string[]},OR:[{status:"VALIDATED"},{answerSource:"OFFICIAL_PDF_MULTIPLE"}]},select:{id:true,answer:true,prompt:true,options:true,answerSource:true,warnings:true}});
 const {correct,score,total}=grade(qs,answers);
 const done=await db.attempt.update({where:{id:a.id},data:{status:"FINISHED",score,finishedAt:new Date()}});
 res.json({attempt:done,score,correct,total,review:qs.map(q=>({id:q.id,prompt:q.prompt,options:q.options,selected:answers[q.id]||null,correct:q.answer,probableAnswerError:isProbableAnswerError(q.warnings),officialAnswerCandidates:officialAnswerCandidates(q.answerSource,q.warnings)}))});
});
app.get("/api/progress/me",auth,async(req:any,res)=>{const attempts=await db.attempt.findMany({where:{userId:req.user.id,status:"FINISHED"},select:{id:true,kind:true,score:true,finishedAt:true}});res.json({attempts,completed:attempts.length,average:attempts.length?attempts.reduce((s,a)=>s+(a.score||0),0)/attempts.length:0})});
app.get("/api/admin/review-issues",auth,admin,async(_req,res)=>res.json(await db.question.findMany({where:{status:"PENDING_REVIEW"},include:{exam:true},take:100})));
app.patch("/api/admin/questions/:id",auth,admin,async(req,res)=>{const v=z.object({prompt:z.string().optional(),answer:z.string().nullable().optional(),status:z.enum(["VALIDATED","PENDING_REVIEW","REJECTED"]).optional()}).parse(req.body);res.json(await db.question.update({where:{id:req.params.id},data:v}))});
app.get("/api/admin/users",auth,admin,async(_req,res)=>{
 const users=await db.user.findMany({orderBy:{createdAt:"desc"},select:{id:true,email:true,name:true,role:true,active:true,createdAt:true}});
 res.json({users});
});
app.post("/api/admin/users",auth,admin,async(req,res)=>{
 const parsed=z.object({name:z.string().trim().min(1).max(100),email:z.string().trim().email().transform((value)=>value.toLowerCase()),password:z.string().min(10).max(128),role:z.enum(["STUDENT","ADMIN"]).default("STUDENT")}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:"Revisa nombre, correo, contraseña (mínimo 10 caracteres) y rol."});
 const {name,email,password,role}=parsed.data;
 try {
  const user=await db.user.create({data:{name,email,role,active:true,passwordHash:await bcrypt.hash(password,12)},select:{id:true,email:true,name:true,role:true,active:true,createdAt:true}});
  res.status(201).json({user});
 }catch(error:any){if(error.code==="P2002")return res.status(409).json({error:"Ya existe un usuario con ese correo."});throw error}
});

type StagedQuestion = { number:number; prompt:string; options:Record<string,string>; answer:string|null; answerSource:string|null; officialAnswerCandidates?:string[]; probableAnswerError?:boolean; confidence:number; startPage:number|null; endPage:number|null; rawText:string|null; warnings:string[]; status?:"PENDING_REVIEW"|"VALIDATED"|"REJECTED"; validationMethod?:string|null; imagePath?:string; imageReviewStatus?:string };
type Correction = { prompt?:string; options?:Record<string,string>; answer?:string|null; status?:"PENDING_REVIEW"|"VALIDATED"|"REJECTED"; reviewerNote?:string; updatedAt:string; updatedBy:string; imagePath?:string; imageReviewStatus?:"PENDING_REVIEW"|"ATTACHED"|"NOT_REQUIRED" };
type Corrections = Record<string,Record<string,Correction>>;
function readCorrections():Corrections { if(!existsSync(correctionsFile))return {}; try{return JSON.parse(readFileSync(correctionsFile,"utf8")) as Corrections}catch{return {}} }
function walkFiles(dir:string):string[] { if(!existsSync(dir))return []; return readdirSync(dir).flatMap((name)=>{const path=join(dir,name);return statSync(path).isDirectory()?walkFiles(path):path.toLowerCase().endsWith(".pdf")?[path]:[]}) }
let pdfHashCache:Map<string,string[]>|null=null;
function currentPdfPaths():Map<string,string[]> { if(pdfHashCache)return pdfHashCache;const paths=new Map<string,string[]>(); for(const path of walkFiles(pdfRoot)){if(basename(path).toLowerCase().includes("marees"))continue;const sha=createHash("sha256").update(readFileSync(path)).digest("hex");const list=paths.get(sha)||[];list.push(path);paths.set(sha,list)} pdfHashCache=paths;return paths }
app.get("/api/admin/ocr-review",auth,ocrAdmin,(_req,res)=>{
 try {
   const corrections=readCorrections(), pdfPaths=currentPdfPaths(), items:any[]=[];
   const counts={total:0,pending:0,validated:0,rejected:0,imagePending:0,imageAttached:0,autoValidated:0,probableAnswerErrors:0};
  for(const name of readdirSync(stagingDir).filter((file)=>file.endsWith(".json"))){
   const document=JSON.parse(readFileSync(join(stagingDir,name),"utf8")); const sha=String(document.sha256||name.replace(/\.json$/,""));
   const sources=(pdfPaths.get(sha)||[]).map((path)=>relative(resolve(process.cwd(),".."),path).replaceAll("\\","/"));
   for(const question of document.questions as StagedQuestion[]){
    const correction=corrections[sha]?.[String(question.number)];
    const reviewStatus=correction?.status||question.status||"PENDING_REVIEW";
    const imageReviewStatus=correction?.imageReviewStatus||(correction?.imagePath?"ATTACHED":question.imageReviewStatus||"NONE");
     counts.total++;
     if(reviewStatus==="PENDING_REVIEW")counts.pending++;if(reviewStatus==="VALIDATED")counts.validated++;if(reviewStatus==="REJECTED")counts.rejected++;if(imageReviewStatus==="PENDING_REVIEW")counts.imagePending++;if(imageReviewStatus==="AUTO_ATTACHED"||imageReviewStatus==="ATTACHED")counts.imageAttached++;if(question.validationMethod==="AUTO_HIGH_CONFIDENCE_OFFICIAL_ANSWER"||question.validationMethod==="AUTO_OFFICIAL_MULTIPLE_ANSWER_REQUIRES_NOTICE")counts.autoValidated++;if(question.probableAnswerError)counts.probableAnswerErrors++;
    const unresolved=reviewStatus==="PENDING_REVIEW"||imageReviewStatus==="PENDING_REVIEW"||question.probableAnswerError===true;
    if(!unresolved&&!correction)continue;
    items.push({sha256:sha,filename:document.source,number:question.number,prompt:correction?.prompt??question.prompt,options:correction?.options??question.options,answer:correction&&Object.hasOwn(correction,"answer")?correction.answer:question.answer,answerSource:question.answerSource,officialAnswerCandidates:question.officialAnswerCandidates||[],probableAnswerError:question.probableAnswerError===true,confidence:question.confidence,startPage:question.startPage,endPage:question.endPage,rawText:question.rawText,warnings:question.warnings||[],metadata:document.metadata||{},sourcePaths:sources,reviewStatus,reviewerNote:correction?.reviewerNote||"",updatedAt:correction?.updatedAt||null,imagePath:imageReviewStatus==="NOT_REQUIRED"?null:correction?.imagePath||question.imagePath||null,imageReviewStatus,validationMethod:question.validationMethod||null});
   }
  }
  items.sort((a,b)=>a.filename.localeCompare(b.filename,"es")||a.number-b.number);
  const status=String((_req.query as any).status||"pending");
  const filtered=status==="all"?items.filter((item)=>item.reviewStatus==="PENDING_REVIEW"||item.imageReviewStatus==="PENDING_REVIEW"||item.probableAnswerError):status==="images"?items.filter((item)=>item.imageReviewStatus==="PENDING_REVIEW"):status==="answer-errors"?items.filter((item)=>item.probableAnswerError):status==="pending"?items.filter((item)=>item.reviewStatus==="PENDING_REVIEW"&&!item.probableAnswerError):items.filter((item)=>item.reviewStatus===status.toUpperCase());
   res.json({items:filtered,counts});
 }catch(error:any){res.status(500).json({error:`No se pudo cargar staging: ${error.message}`})}
});
app.get("/api/admin/ocr-review/:sha/pdf",auth,ocrAdmin,(req,res)=>{
 try {if(!/^[a-f0-9]{64}$/.test(req.params.sha))return res.status(400).json({error:"SHA inválido"});const path=currentPdfPaths().get(req.params.sha)?.[0];if(!path)return res.status(404).json({error:"PDF no encontrado en la colección actual"});res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition","inline");res.sendFile(path)}catch(error:any){res.status(500).json({error:error.message})}
});
app.get("/api/admin/ocr-review/:sha/page/:page",auth,ocrAdmin,(req,res)=>{
 try {
  if(!/^[a-f0-9]{64}$/.test(req.params.sha))return res.status(400).json({error:"SHA inválido"});
  const page=Number(req.params.page);if(!Number.isInteger(page)||page<1)return res.status(400).json({error:"Página inválida"});
  const pdf=currentPdfPaths().get(req.params.sha)?.[0];if(!pdf)return res.status(404).json({error:"PDF no encontrado en la colección actual"});
  const output=join(storageRoot,"review-page-previews",req.params.sha,`${page}.png`);
  if(!existsSync(output))execFileSync(process.env.PYTHON_EXECUTABLE||"python",[resolve(process.cwd(),"../importer/render_pdf_region.py"),"--pdf",pdf,"--page",String(page),"--output",output],{timeout:30000});
  res.setHeader("Cache-Control","private, max-age=3600");res.sendFile(output);
 }catch(error:any){res.status(500).json({error:`No se pudo renderizar la página: ${error.message}`})}
});
app.post("/api/admin/ocr-review/:sha/:number/image",auth,ocrAdmin,(req:any,res)=>{
 const parsed=z.object({page:z.number().int().positive(),crop:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)})}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:"Recorte no válido",details:parsed.error.flatten()});
 const {page,crop}=parsed.data;if(crop.x+crop.width>1.001||crop.y+crop.height>1.001||crop.width<0.015||crop.height<0.015)return res.status(400).json({error:"Selecciona un recorte dentro de la página"});
 if(!/^[a-f0-9]{64}$/.test(req.params.sha)||!/^\d+$/.test(req.params.number))return res.status(400).json({error:"Identificador de pregunta no válido"});
 try {
  const pdf=currentPdfPaths().get(req.params.sha)?.[0];if(!pdf)return res.status(404).json({error:"PDF no encontrado en la colección actual"});
  const filename=`${req.params.sha}-${req.params.number}.png`,imageDir=join(storageRoot,"question-images"),output=join(imageDir,filename);
  execFileSync(process.env.PYTHON_EXECUTABLE||"python",[resolve(process.cwd(),"../importer/render_pdf_region.py"),"--pdf",pdf,"--page",String(page),"--output",output,"--crop",String(crop.x),String(crop.y),String(crop.width),String(crop.height)],{timeout:30000});
  const corrections=readCorrections();corrections[req.params.sha] ||= {};const previous=corrections[req.params.sha][req.params.number]||{} as Correction;
  corrections[req.params.sha][req.params.number]={...previous,imagePath:filename,imageReviewStatus:"ATTACHED",updatedAt:new Date().toISOString(),updatedBy:String(req.user?.id||"")};
  const temp=`${correctionsFile}.tmp`;writeFileSync(temp,JSON.stringify(corrections,null,2),"utf8");renameSync(temp,correctionsFile);
  res.json({ok:true,imagePath:filename});
 }catch(error:any){res.status(500).json({error:`No se pudo guardar la imagen: ${error.message}`})}
});
app.get("/api/admin/ocr-review/:sha/:number/image",auth,ocrAdmin,(req,res)=>{
 try {
  if(!/^[a-f0-9]{64}$/.test(req.params.sha)||!/^[0-9]+$/.test(req.params.number))return res.status(400).json({error:"Identificador no válido"});
  const correction=readCorrections()[req.params.sha]?.[req.params.number];if(correction?.imageReviewStatus==="NOT_REQUIRED")return res.status(404).json({error:"Esta pregunta está marcada sin imagen"});
  const documentPath=join(stagingDir,`${req.params.sha}.json`);if(!existsSync(documentPath))return res.status(404).json({error:"Documento staging no encontrado"});
  const document=JSON.parse(readFileSync(documentPath,"utf8")),question=document.questions.find((item:any)=>item.number===Number(req.params.number));
  const filename=correction?.imagePath||question?.imagePath;if(!filename||!/^[a-f0-9]{64}-\d+(?:-auto)?\.png$/.test(filename))return res.status(404).json({error:"La pregunta aún no tiene imagen asociada"});
  const storageImage=join(storageRoot,"question-images",filename),stagingImage=resolve(stagingDir,"../images",filename),image=existsSync(storageImage)?storageImage:stagingImage;
  if(!existsSync(image))return res.status(404).json({error:"Archivo de imagen no encontrado"});res.type("png").sendFile(image);
 }catch(error:any){res.status(500).json({error:error.message})}
});
app.get("/api/question-images/:filename",auth,async(req,res)=>{
 const filename=String(req.params.filename);if(!/^[a-f0-9]{64}-\d+(?:-auto)?\.png$/.test(filename))return res.status(400).json({error:"Imagen no v?lida"});
 const question=await db.question.findFirst({where:{imagePath:filename,status:"VALIDATED",exam:{status:"PUBLISHED"}},select:{imageData:true}});
 if(!question)return res.status(404).json({error:"Imagen no disponible"});
 if(!question.imageData)return res.status(404).json({error:"Imagen no encontrada en la base de datos"});
 res.setHeader("Cache-Control","private, max-age=3600");res.type("png").send(Buffer.from(question.imageData));
});
app.patch("/api/admin/ocr-review/:sha/:number",auth,ocrAdmin,(req:any,res)=>{
 const parsed=z.object({prompt:z.string().min(1),options:z.record(z.string(),z.string()),answer:z.string().nullable(),status:z.enum(["PENDING_REVIEW","VALIDATED","REJECTED"]),reviewerNote:z.string().max(2000).default(""),imageReviewStatus:z.enum(["PENDING_REVIEW","ATTACHED","NOT_REQUIRED"]).optional()}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:"Corrección no válida",details:parsed.error.flatten()});
 if(!/^[a-f0-9]{64}$/.test(req.params.sha)||!/^\d+$/.test(req.params.number))return res.status(400).json({error:"Identificador de pregunta no válido"});
 const {prompt,options,answer,status,reviewerNote,imageReviewStatus}=parsed.data;
 if(!Object.keys(options).length||Object.values(options).some((value)=>!value.trim())||(answer!==null&&!Object.hasOwn(options,answer)))return res.status(400).json({error:"Revisa las opciones y la respuesta seleccionada"});
 try {const corrections=readCorrections();const temp=`${correctionsFile}.tmp`;corrections[req.params.sha] ||= {};const previous=corrections[req.params.sha][req.params.number];const next:Correction={...previous,prompt:prompt.trim(),options,answer,status,reviewerNote:reviewerNote.trim(),...(imageReviewStatus?{imageReviewStatus}:{}),updatedAt:new Date().toISOString(),updatedBy:String(req.user?.id||"")};if(imageReviewStatus==="NOT_REQUIRED")delete next.imagePath;corrections[req.params.sha][req.params.number]=next;writeFileSync(temp,JSON.stringify(corrections,null,2),"utf8");renameSync(temp,correctionsFile);res.json({ok:true,correction:corrections[req.params.sha][req.params.number]})}catch(error:any){res.status(500).json({error:`No se pudo guardar: ${error.message}`})}
});
app.listen(port,()=>console.log(`API listening on ${port}`));

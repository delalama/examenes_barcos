import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || "../.env" });
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const args=process.argv.slice(2), value=(k:string)=>args[args.indexOf(k)+1];
const email=value("--email"),password=value("--password");
if(!email||!password||password.length<12) throw new Error("Uso: npm run admin -- --email admin@ejemplo.es --password <12+ caracteres>");
async function main(){
 const db=new PrismaClient();
 try { await db.user.upsert({where:{email},update:{role:"ADMIN"},create:{email,name:"Administrador",passwordHash:await bcrypt.hash(password,12),role:"ADMIN"}}); console.log(`Administrador listo: ${email}`); }
 finally { await db.$disconnect(); }
}
main();

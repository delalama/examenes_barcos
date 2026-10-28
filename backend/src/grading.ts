export function grade(questions:{id:string;answer:string|null;answerSource?:string|null;warnings?:string[]}[], answers:Record<string,string>){
 const scored=questions.filter(q=>q.answerSource!=="OFFICIAL_PDF_MULTIPLE"&&!q.warnings?.some((warning)=>warning.includes("probablemente errónea")));
 const correct=scored.filter(q=>q.answer!==null&&q.answer===answers[q.id]).length;
 return {correct,total:scored.length,score:scored.length?100*correct/scored.length:0};
}

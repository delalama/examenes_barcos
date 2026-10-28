import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import AdminReview from "./AdminReview";
import ReviewBlock from "./ReviewBlock";
import AdminUsers from "./AdminUsers";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const adminOcrEnabled = import.meta.env.VITE_ADMIN_OCR_ENABLED !== "false";
type Exam = { id:string; title:string; license:string; island:string|null; year:number|null; session:string|null; pendingReviewCount:number };
type Question = { id:string; number:number; prompt:string; options:Record<string,string>; imagePath?:string|null; probableAnswerError?:boolean; officialAnswerCandidates?:string[] };

export default function App() {
  const [token,setToken]=useState(localStorage.getItem("token")||"");
  const [user,setUser]=useState<any>(null);
  const [theme,setTheme]=useState<"LIGHT"|"DARK">(localStorage.getItem("theme")==="DARK"?"DARK":"LIGHT");
  const [exams,setExams]=useState<Exam[]>([]);
  const [error,setError]=useState("");
  const navigate=useNavigate();
  const api=useCallback(async(path:string,init:RequestInit={})=>{
    const response=await fetch(API+path,{...init,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{ }),...init.headers}});
    const body=await response.text();
    let data:any={};
    try{data=body?JSON.parse(body):{}}catch{data={error:body.startsWith("<")?`El servidor respondi? con HTTP ${response.status}.`:body||`Error HTTP ${response.status}.`}}
    if(!response.ok)throw Error(data.error||`Error HTTP ${response.status}.`);
    return data;
  },[token]);

  useEffect(()=>{document.documentElement.dataset.theme=theme.toLowerCase();localStorage.setItem("theme",theme)},[theme]);

  useEffect(()=>{
    if(!token)return;
    api("/auth/me").then((data:any)=>{setUser(data);if(data.preferences?.theme==="LIGHT"||data.preferences?.theme==="DARK")setTheme(data.preferences.theme)}).catch(()=>{localStorage.removeItem("token");setToken("")});
    api("/exams").then(setExams).catch((e)=>setError(e.message));
  },[api,token]);

  async function login(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError("");const form=new FormData(event.currentTarget);
    try{const data=await api("/auth/login",{method:"POST",body:JSON.stringify({email:form.get("email"),password:form.get("password")})});localStorage.setItem("token",data.token);setToken(data.token);setUser(null)}catch(e:any){setError(e.message)}
  }
  function logout(){localStorage.removeItem("token");setToken("");setUser(null)}
  async function toggleTheme(){const next=theme==="DARK"?"LIGHT":"DARK";setTheme(next);try{const preferences=await api("/users/me/preferences",{method:"PATCH",body:JSON.stringify({theme:next})});setUser((current:any)=>current?{...current,preferences}:current)}catch(e:any){setTheme(theme);setError(e.message||"No se pudo guardar el tema")}}

  return <main>
    <header><Link to="/" className="brand">⚓ PRÁCTICA <span>EXÁMENES</span></Link>{user&&<nav><Link to="/">Inicio</Link><Link to="/review-block">Bloque de repaso</Link><Link to="/progress">Mi progreso</Link><Link to="/settings">Opciones</Link><button type="button" className="theme-toggle" onClick={()=>void toggleTheme()} aria-label={theme==="DARK"?"Activar tema claro":"Activar tema oscuro"}>{theme==="DARK"?"☀":"☾"}<span>{theme==="DARK"?"Claro":"Oscuro"}</span></button>{user.role==="ADMIN"&&<Link to="/admin/revision-ocr">Admin · OCR</Link>}{user.role==="ADMIN"&&<Link to="/admin/users">Usuarios</Link>}<button className="ghost" onClick={logout}>Salir</button></nav>}</header>
    {error&&<div role="alert" className="error">{error}<button onClick={()=>setError("")}>×</button></div>}
    {!user?<section className="hero"><div><div className="eyebrow">FORMACIÓN NÁUTICA · ILLES BALEARS</div><h1>Tu próximo título<br/><em>empieza aquí.</em></h1><p>Practica con exámenes oficiales PNB, PER, PY y CY. A tu ritmo, desde cualquier lugar.</p><div className="chips">{["PNB","PER","PY","CY"].map((license)=><span key={license}>{license}</span>)}</div></div><form className="card login" onSubmit={login}><h2>Bienvenido</h2><p>Accede para continuar practicando.</p><label>Correo electrónico<input name="email" type="email" required autoComplete="email"/></label><label>Contraseña<input name="password" type="password" required autoComplete="current-password"/></label><button className="primary">Iniciar sesión →</button></form></section>:<Routes>
      <Route path="/" element={<Home user={user} setUser={setUser} exams={exams} api={api} navigate={navigate}/>}/>
      <Route path="/settings" element={<Settings user={user} setUser={setUser} api={api}/>}/>
      <Route path="/progress" element={<Progress api={api}/>}/>
      <Route path="/attempt/:id" element={<Attempt api={api} token={token}/>}/>
      <Route path="/review-block" element={<ReviewBlock api={api} navigate={navigate}/>}/>
      <Route path="/admin/users" element={user.role==="ADMIN"?<AdminUsers api={api}/>:<Home user={user} setUser={setUser} exams={exams} api={api} navigate={navigate}/>}/>
      <Route path="/admin/revision-ocr" element={user.role==="ADMIN"&&adminOcrEnabled?<AdminReview api={api} token={token}/>:<Home user={user} setUser={setUser} exams={exams} api={api} navigate={navigate}/>}/>
      <Route path="*" element={<Home user={user} setUser={setUser} exams={exams} api={api} navigate={navigate}/>}/>
    </Routes>}
    <footer>PRÁCTICA EXÁMENES NÁUTICOS <span>Hecho para navegar con confianza · Illes Balears</span></footer>
  </main>;
}

function Home({user,setUser,exams,api,navigate}:any){
  const [mode,setMode]=useState<'ONE_BY_ONE'|'ROUND'>('ONE_BY_ONE');
  const [license,setLicense]=useState(user.preferences?.licenses?.[0]||'');
  const [questionCount,setQuestionCount]=useState(10);
  const [withImage,setWithImage]=useState(false);
  const [island,setIsland]=useState('');
  const [year,setYear]=useState('');
  const [searched,setSearched]=useState(false);
  const [savingPreference,setSavingPreference]=useState(false);
  const hasLicensePreference=Boolean(user.preferences?.licenses?.length);
  const filteredExams=exams.filter((exam:Exam)=>(!license||exam.license===license)&&(!island||exam.island===island)&&(!year||String(exam.year)===year));
  const years:number[]=Array.from(new Set<number>((exams as Exam[]).map(exam=>exam.year).filter((value):value is number=>Boolean(value)))).sort((a,b)=>b-a);
  const examTree=new Map<string,Map<string,Map<string,Map<string,Exam[]>>>>();
  for(const exam of filteredExams as Exam[]){
    const islandName=exam.island||"Sin isla",licenseName=exam.license||"Sin titulaci?n",yearName=exam.year?String(exam.year):"Sin a?o",sessionName=exam.session?.trim()||"Sin convocatoria";
    if(!examTree.has(islandName))examTree.set(islandName,new Map());
    const licenses=examTree.get(islandName)!;
    if(!licenses.has(licenseName))licenses.set(licenseName,new Map());
    const yearsForLicense=licenses.get(licenseName)!;
    if(!yearsForLicense.has(yearName))yearsForLicense.set(yearName,new Map());
    const sessions=yearsForLicense.get(yearName)!;
    if(!sessions.has(sessionName))sessions.set(sessionName,[]);
    sessions.get(sessionName)!.push(exam);
  }
  const licenseOrder=["PNB","PER","PY","CY"];
  const islandOrder=["Mallorca","Menorca","Ibiza","Sin isla"];
  const monthOrder=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const catalogGroups=Array.from(examTree.entries()).map(([islandName,licenses])=>({
    island:islandName,
    licenses:Array.from(licenses.entries()).sort(([a],[b])=>(licenseOrder.indexOf(a)<0?99:licenseOrder.indexOf(a))-(licenseOrder.indexOf(b)<0?99:licenseOrder.indexOf(b))).map(([licenseName,yearsByName])=>({
      license:licenseName,
      years:Array.from(yearsByName.entries()).sort(([a],[b])=>a==="Sin a?o"?1:b==="Sin a?o"?-1:Number(b)-Number(a)).map(([yearName,sessionsByName])=>({
        year:yearName,
        sessions:Array.from(sessionsByName.entries()).sort(([a],[b])=>{const ai=monthOrder.indexOf(a.toLocaleLowerCase("es-ES")),bi=monthOrder.indexOf(b.toLocaleLowerCase("es-ES"));return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b,"es")}).map(([sessionName,items])=>({session:sessionName==="Sin convocatoria"?sessionName:sessionName.charAt(0).toLocaleUpperCase("es-ES")+sessionName.slice(1),exams:items}))
      }))
    }))
  })).sort((a,b)=>{const ai=islandOrder.indexOf(a.island),bi=islandOrder.indexOf(b.island);return (ai<0?99:ai)-(bi<0?99:bi)||a.island.localeCompare(b.island,"es")});
  useEffect(()=>{if(user.preferences?.licenses?.[0])setLicense(user.preferences.licenses[0])},[user.preferences?.licenses?.[0]]);
  async function saveInterest(value:string){
    setSavingPreference(true);
    try{const preferences=await api('/users/me/preferences',{method:'PATCH',body:JSON.stringify({licenses:[value],islands:user.preferences?.islands||[]})});setUser({...user,preferences});setLicense(value)}
    catch(e:any){alert(e.message||'No se pudo guardar la preferencia')}
    finally{setSavingPreference(false)}
  }
  async function startPractice(kind:'ONE_BY_ONE'|'ROUND',count:number,imageOnly=false){
    const data=await api('/attempts',{method:'POST',body:JSON.stringify({kind,license,questionCount:count,withImage:imageOnly})});
    sessionStorage.setItem('practiceKind',kind);sessionStorage.setItem('practiceLicense',license);sessionStorage.setItem('practiceSource','RANDOM');sessionStorage.setItem('practiceWithImage',String(imageOnly));
    sessionStorage.setItem('questions',JSON.stringify(data.questions));navigate(`/attempt/${data.attemptId}`);
  }
  async function startExam(exam:Exam){
    const data=await api('/attempts',{method:'POST',body:JSON.stringify({examId:exam.id,kind:'OFFICIAL'})});
    sessionStorage.setItem('practiceKind','OFFICIAL');sessionStorage.setItem('practiceLicense',exam.license);sessionStorage.setItem('practiceSource','OFFICIAL');
    sessionStorage.setItem('questions',JSON.stringify(data.questions));navigate(`/attempt/${data.attemptId}`);
  }
  if(!hasLicensePreference)return <div className="content onboarding-content"><section className="interest-card card"><div className="eyebrow">PARA EMPEZAR</div><h1>¿Qué titulación te interesa ahora?</h1><p>Así preseleccionaremos los exámenes y las preguntas de práctica. Podrás cambiarlo cuando quieras en Opciones.</p><div className="interest-options">{['PNB','PER','PY','CY'].map(value=><button key={value} className="outline" disabled={savingPreference} onClick={()=>void saveInterest(value)}>{value}</button>)}</div></section></div>;
  return <div className="content">
    <div className="welcome"><div><div className="eyebrow">PANEL DE ESTUDIO</div><h1>Hola, {user.name.split(' ')[0]}</h1><p>¿Qué te apetece repasar hoy?</p></div><div className="round" aria-hidden="true">⚓</div></div>
    <section className="practice-config card">
      <div className="practice-summary"><div className="eyebrow">MODO PRÁCTICA RÁPIDA</div><h2>Un poco cada día<br/>te acerca al título.</h2><p>Practica una pregunta cada vez o completa una ronda y revisa tus fallos.</p></div>
      <div className="practice-config-controls"><div className="eyebrow">CONFIGURACIÓN RÁPIDA</div><h3>¿Cómo quieres practicar?</h3><div className="practice-fields"><label>Modo<select value={mode} onChange={e=>setMode(e.target.value as 'ONE_BY_ONE'|'ROUND')}><option value="ONE_BY_ONE">Una a una · corrección instantánea</option><option value="ROUND">Ronda · resultado al final</option></select></label><label>Titulación<select value={license} onChange={e=>setLicense(e.target.value)}>{['PNB','PER','PY','CY'].map(value=><option key={value}>{value}</option>)}</select></label>{mode==='ROUND'&&<label>Número de preguntas<select value={questionCount} onChange={e=>setQuestionCount(Number(e.target.value))}>{[5,10,20,40].map(value=><option key={value} value={value}>{value}</option>)}</select></label>}</div><label className="practice-image-filter"><input type="checkbox" checked={withImage} onChange={e=>setWithImage(e.target.checked)}/><span>Practicar solo preguntas con imagen</span></label><button className="primary" onClick={()=>void startPractice(mode,mode==='ONE_BY_ONE'?1:questionCount,withImage)}>{mode==='ONE_BY_ONE'?'Empezar una a una':`Empezar ronda de ${questionCount}`}</button></div>
    </section>
    <Link className="review-block-link card" to="/review-block"><span><b>Bloque de repaso</b><small>Administra las preguntas difíciles y mide tu progreso.</small></span><strong>Ver bloque</strong></Link>
    <div className="section-title"><div><div className="eyebrow">TU PREPARACIÓN</div><h2>Buscar exámenes oficiales</h2></div><span>{searched?`${filteredExams.length} resultados`:`${exams.length} exámenes disponibles`}</span></div>
    <section className="exam-search card"><label>Isla<select value={island} onChange={e=>{setIsland(e.target.value);setSearched(false)}}><option value="">Todas las islas</option>{['Mallorca','Menorca','Ibiza'].map(value=><option key={value}>{value}</option>)}</select></label><label>Titulación<select value={license} onChange={e=>{setLicense(e.target.value);setSearched(false)}}><option value="">Todas</option>{['PNB','PER','PY','CY'].map(value=><option key={value}>{value}</option>)}</select></label><label>Año<select value={year} onChange={e=>{setYear(e.target.value);setSearched(false)}}><option value="">Todos</option>{years.map(value=><option key={value} value={value}>{value}</option>)}</select></label><button className="primary" disabled={!license&&!island&&!year} onClick={()=>setSearched(true)}>Buscar exámenes</button></section>
    {searched&&filteredExams.length>0?(
      <div className="exam-catalog">
        {catalogGroups.map(islandGroup=>(
          <section className="island-block" key={islandGroup.island}>
            <div className="island-block-heading">
              <span className="student-cap" aria-hidden="true">??</span>
              <div><span className="group-label">ISLA</span><h3>{islandGroup.island}</h3></div>
              <span className="group-total">{islandGroup.licenses.reduce((n,group)=>n+group.years.reduce((y,yearGroup)=>y+yearGroup.sessions.reduce((m,sessionGroup)=>m+sessionGroup.exams.length,0),0),0)} examenes</span>
            </div>
            {islandGroup.licenses.map(licenseGroup=>(
              <section className="qualification-block" key={licenseGroup.license}>
                <div className={`qualification-heading course-${licenseGroup.license.toLowerCase()}`}><span className="course-swatch" aria-hidden="true"/><h4>{licenseGroup.license}</h4></div>
                {licenseGroup.years.map(yearGroup=>(
                  <section className="year-block" key={yearGroup.year}>
                    <h5 className="year-heading">{yearGroup.year}</h5>
                    {yearGroup.sessions.map(sessionGroup=>(
                      <section className="session-block" key={sessionGroup.session}>
                        <div className="session-heading"><span className="session-kicker">CONVOCATORIA</span><h6>{sessionGroup.session}</h6></div>
                        <div className="exam-grid">
                          {sessionGroup.exams.map(exam=>(
                            <article className={`school-exam-card course-${licenseGroup.license.toLowerCase()}`} key={exam.id}>
                              <div className="school-exam-title"><span className="school-book" aria-hidden="true">📘</span><h6>{exam.title.replace(/\.pdf$/i,'')}</h6></div>
                              {exam.pendingReviewCount>0&&<p className="pending-admin-review">Revision admin pendiente ? {exam.pendingReviewCount}</p>}
                              <button className="outline" onClick={()=>void startExam(exam)}>Hacer examen <span>→</span></button>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </section>
                ))}
              </section>
            ))}
          </section>
        ))}
      </div>
    ):searched?<p className="empty">No hay examenes que coincidan. Prueba con otros filtros.</p>:<p className="empty search-hint">Elige al menos un filtro para mostrar los resultados.</p>}
    <div className="note"><span aria-hidden="true">⚓</span><span><b>Consejo de navegación</b><br/>Lee cada pregunta con calma y confía en lo que has estudiado.</span></div>
  </div>;
}

function Settings({user,setUser,api}:any){
  const [license,setLicense]=useState(user.preferences?.licenses?.[0]||'');
  const [saved,setSaved]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{api('/users/me/preferences').then((p:any)=>{if(p?.licenses?.[0])setLicense(p.licenses[0])}).catch((e:any)=>setError(e.message))},[api]);
  async function save(event:React.FormEvent){event.preventDefault();setSaved(false);setError('');try{const preferences=await api('/users/me/preferences',{method:'PATCH',body:JSON.stringify({licenses:license?[license]:[],islands:user.preferences?.islands||[]})});setUser({...user,preferences});setSaved(true)}catch(e:any){setError(e.message)}}
  return <div className="content settings-page"><div className="eyebrow">PERSONALIZACIÓN</div><h1>Opciones</h1><form className="card settings-card" onSubmit={save}><h2>Titulación de interés</h2><p>Se preseleccionará en el buscador de exámenes y en la práctica aleatoria.</p><label>Titulación<select value={license} onChange={e=>setLicense(e.target.value)}><option value="">Sin preferencia</option>{['PNB','PER','PY','CY'].map(value=><option key={value}>{value}</option>)}</select></label><button className="primary">Guardar cambios</button>{saved&&<span className="settings-saved">Preferencia guardada.</span>}{error&&<div className="error-inline" role="alert">{error}</div>}</form></div>
}

function Attempt({api,token}:any){const {id}=useParams();const navigate=useNavigate();return <AttemptInner key={id} id={id} api={api} token={token} navigate={navigate}/>}
function AttemptInner({id,api,token,navigate}:any){
  const questions:Question[]=JSON.parse(sessionStorage.getItem('questions')||'[]');
  const mode=sessionStorage.getItem('practiceKind')||'OFFICIAL',license=sessionStorage.getItem('practiceLicense')||'PER',source=sessionStorage.getItem('practiceSource')||'RANDOM';
  const [answers,setAnswers]=useState<Record<string,string>>({}),[index,setIndex]=useState(0),[result,setResult]=useState<any>(null),[reviewIds,setReviewIds]=useState<Set<string>>(new Set()),[saving,setSaving]=useState(false),[error,setError]=useState('');
  useEffect(()=>{api('/review-block').then((data:any)=>setReviewIds(new Set(data.items.map((item:any)=>item.questionId)))).catch(()=>{})},[api]);
  async function save(next:Record<string,string>){await api(`/attempts/${id}/answers`,{method:'PATCH',body:JSON.stringify({answers:next})})}
  async function finish(next=answers){setSaving(true);setError('');try{await save(next);setResult(await api(`/attempts/${id}/finish`,{method:'POST'}))}catch(e:any){setError(e.message||'No se pudo cerrar la ronda')}finally{setSaving(false)}}
  async function choose(key:string){const next={...answers,[question.id]:key};setAnswers(next);try{if(mode==='ONE_BY_ONE')await finish(next);else await save(next)}catch(e:any){setError(e.message||'No se pudo guardar la respuesta')}}
  async function toggleReview(questionId:string){try{if(reviewIds.has(questionId)){await api(`/review-block/${questionId}`,{method:'DELETE'});setReviewIds(current=>{const n=new Set(current);n.delete(questionId);return n})}else{await api(`/review-block/${questionId}`,{method:'POST'});setReviewIds(current=>new Set(current).add(questionId))}}catch(e:any){setError(e.message||'No se pudo actualizar el bloque de repaso')}}
  async function markMastered(questionId:string){try{await api(`/review-block/${questionId}`,{method:'PATCH',body:JSON.stringify({mastered:true})});setReviewIds(current=>{const n=new Set(current);n.delete(questionId);return n})}catch(e:any){setError(e.message||'No se pudo marcar como aprendida')}}
  async function anotherQuestion(){setSaving(true);setError('');try{const data=await api('/attempts',{method:'POST',body:JSON.stringify({kind:'ONE_BY_ONE',license,questionCount:1,reviewBlockOnly:source==='REVIEW_BLOCK',withImage:sessionStorage.getItem('practiceWithImage')==='true'})});sessionStorage.setItem('questions',JSON.stringify(data.questions));navigate(`/attempt/${data.attemptId}`)}catch(e:any){setError(e.message||'No hay más preguntas disponibles')}finally{setSaving(false)}}
  if(result && mode!=='ONE_BY_ONE'){
    const review=result.review||[];
    const shown=mode==='ROUND'||mode==='REVIEW_BLOCK'?review.filter((q:any)=>q.probableAnswerError||!q.selected||q.selected!==q.correct):review;
    const oneByOne=mode==='ONE_BY_ONE';
    return <div className="content result"><div className="eyebrow">{oneByOne?'CORRECCIÓN INSTANTÁNEA':mode==='OFFICIAL'?'REVISIÓN DEL EXAMEN':'RESULTADO DE LA RONDA'}</div>{!oneByOne&&<><h1>{Math.round(result.score)}<small>/100</small></h1><p>{result.correct} respuestas correctas de {result.total} preguntas puntuables</p></>}{oneByOne&&<h1>{review[0]?.selected===review[0]?.correct?'¡Correcto!':'Revisa la respuesta'}</h1>}{shown.length?shown.map((q:any,n:number)=>{const options=Object.entries(q.options||{}) as [string,unknown][],correctAnswers=q.probableAnswerError?(q.officialAnswerCandidates||[]):q.correct?[q.correct]:[];return <article className="card review result-question" key={q.id}><b>{n+1}. {q.prompt}</b>{q.probableAnswerError&&<p className="official-multiple-answer-note">El PDF oficial indica varias respuestas correctas: {(q.officialAnswerCandidates||[]).join(', ')}. Esta pregunta podría contener un error y no se puntúa.</p>}<div className="result-options" aria-label="Opciones de respuesta">{options.map(([key,value])=>{const isCorrect=correctAnswers.includes(key),isWrong=q.selected===key&&!isCorrect;return <div key={key} className={`result-option${isCorrect?' result-option-correct':''}${isWrong?' result-option-incorrect':''}`}><b>{key}</b><span>{String(value)}</span>{isWrong&&<small>Tu respuesta</small>}{isCorrect&&<small>{q.probableAnswerError?'Respuesta oficial':'Respuesta correcta'}</small>}</div>})}</div>{!q.probableAnswerError&&!q.selected&&<p>Sin responder</p>}{source==='REVIEW_BLOCK'?<div className="review-row-actions"><button className="outline" onClick={()=>void markMastered(q.id)}>Ya me la sé</button><button className="text-button" onClick={()=>void toggleReview(q.id)}>Quitar del bloque</button></div>:<button className="outline" onClick={()=>void toggleReview(q.id)}>{reviewIds.has(q.id)?'Quitar del bloque de repaso':'Añadir a bloque de repaso'}</button>}</article>}):<p className="empty">No hay preguntas erróneas en esta ronda. {'¡'}Buen trabajo!</p>}{error&&<div className="error-inline" role="alert">{error}</div>}<div className="result-actions">{oneByOne&&<button className="primary" disabled={saving} onClick={()=>void anotherQuestion()}>{saving?'Cargando…':'Otra pregunta'}</button>}<button className="outline" onClick={()=>navigate(source==='REVIEW_BLOCK'?'/review-block':'/')}>Terminar</button></div></div>;
  }
  const question=questions[index];
  if(!question)return <div className="content"><h2>No hay preguntas disponibles todavía.</h2></div>;
  const feedback=result?.review?.[0];
  return <div className="content quiz"><div className="quiz-head"><div className="eyebrow">{mode==='ONE_BY_ONE'?'UNA A UNA':mode==='OFFICIAL'?'EXAMEN OFICIAL':'RONDA'}{mode!=='ONE_BY_ONE'&&`  · ${index+1} DE ${questions.length}`}</div>{mode!=='ONE_BY_ONE'&&<><progress value={index+1} max={questions.length}/><button className="outline" disabled={saving} onClick={()=>void finish()}>{saving?'Corrigiendo…':'Terminar ronda'}</button></>}</div><article className="card question"><h2>{question.prompt}</h2>{question.imagePath&&<QuestionImage imagePath={question.imagePath} token={token}/ >}{Object.entries(question.options||{}).map(([key,value])=>{const isCorrect=!feedback?.probableAnswerError&&feedback?.correct===key;const isWrong=!feedback?.probableAnswerError&&feedback?.selected===key&&feedback?.selected!==feedback?.correct;return <button key={key} className={`option ${answers[question.id]===key?'selected':''} ${isCorrect?'option-correct':''} ${isWrong?'option-incorrect':''}`} disabled={saving||!!result} onClick={()=>void choose(key)}><b>{key}</b><span>{String(value)}</span>{answers[question.id]===key&&<i>{'✓'}</i>}</button>})}{feedback&&(feedback.probableAnswerError?<div className="official-multiple-answer-note">El PDF oficial indica varias respuestas: {(feedback.officialAnswerCandidates||[]).join(', ')}. Esta pregunta no se puntúa.</div>:<div className={`instant-feedback ${feedback.selected===feedback.correct?'instant-correct':'instant-incorrect'}`}><b>{feedback.selected===feedback.correct?'¡Correcto!':'Incorrecto'}</b>{feedback.selected&&<span>Tu respuesta: {feedback.selected}: {feedback.options?.[feedback.selected]||''}</span>}<span>Correcta: {feedback.correct}: {feedback.options?.[feedback.correct]||''}</span></div>)}{question.probableAnswerError&&!feedback&&<p className="official-multiple-answer-note">El PDF oficial indica varias respuestas: {(question.officialAnswerCandidates||[]).join(', ')}. No se incluirá en la puntuación.</p>}<div className="question-tools">{source==='REVIEW_BLOCK'?<button className="text-button" onClick={()=>void markMastered(question.id)}>Ya me la sé</button>:<button className="text-button" onClick={()=>void toggleReview(question.id)}>{reviewIds.has(question.id)?'Quitar del bloque de repaso':'Añadir a bloque de repaso'}</button>}{mode==='ONE_BY_ONE'&&(result?<button className="primary" disabled={saving} onClick={()=>void anotherQuestion()}>{saving?'Cargando…':'Siguiente pregunta'}</button>:<button className="text-button" disabled={saving} onClick={()=>void finish({})}>No lo sé · ver respuesta</button>)}</div>{error&&<div className="error-inline" role="alert">{error}</div>}{mode!=='ONE_BY_ONE'&&<div className="quiz-nav"><button className="outline" disabled={!index||saving} onClick={()=>setIndex(index-1)}>{'←'} Anterior</button><span>{index+1} / {questions.length}</span><button className="primary" disabled={saving} onClick={()=>index+1<questions.length?setIndex(index+1):void finish()}>{index+1<questions.length?`Siguiente ${'→'}`:`Corregir ronda ${'→'}`}</button></div>}</article></div>;
}
function QuestionImage({imagePath,token}:{imagePath:string;token:string}){const [src,setSrc]=useState("");useEffect(()=>{let url="";const controller=new AbortController();fetch(`${API}/question-images/${encodeURIComponent(imagePath)}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then((response)=>{if(!response.ok)throw new Error("No se pudo cargar la imagen");return response.blob()}).then((blob)=>{url=URL.createObjectURL(blob);setSrc(url)}).catch(()=>setSrc(""));return()=>{controller.abort();if(url)URL.revokeObjectURL(url)}},[imagePath,token]);return src?<img className="exam-question-image" src={src} alt="Imagen de la pregunta"/>:null}

function Progress({api}:any){const [data,setData]=useState<any>(null);useEffect(()=>{api("/progress/me").then(setData)},[api]);return <div className="content"><div className="eyebrow">TU RECORRIDO</div><h1>Mi progreso</h1><div className="stats"><article className="card"><b>{data?.completed||0}</b><span>Exámenes completados</span></article><article className="card"><b>{Math.round(data?.average||0)}%</b><span>Nota media</span></article></div><h2>Actividad reciente</h2>{data?.attempts?.map((attempt:any)=><article className="card review" key={attempt.id}>{attempt.kind} · {Math.round(attempt.score||0)}% · {new Date(attempt.finishedAt).toLocaleDateString("es-ES")}</article>)}</div>}

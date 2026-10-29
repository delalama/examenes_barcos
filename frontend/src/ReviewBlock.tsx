import { useEffect, useState } from "react";

type Item = { questionId:string; masteredAt:string|null; question:{id:string;number:number;prompt:string;options:Record<string,string>;answer:string|null;exam:{title:string;license:string;year:number|null}} };

type Api = (path:string, init?:RequestInit) => Promise<any>;

export default function ReviewBlock({api,navigate,embedded=false}:{api:Api;navigate:(path:string)=>void;embedded?:boolean}) {
  const [items,setItems]=useState<Item[]>([]),[progress,setProgress]=useState({total:0,active:0,mastered:0,progress:0});
  const [mode,setMode]=useState<'ONE_BY_ONE'|'ROUND'>('ONE_BY_ONE'),[questionCount,setQuestionCount]=useState(10),[loading,setLoading]=useState(true),[error,setError]=useState('');
  async function reload(){setLoading(true);setError('');try{const data=await api('/review-block');setItems(data.items);setProgress(data)}catch(e:any){setError(e.message||'No se pudo cargar el bloque de repaso')}finally{setLoading(false)}}
  useEffect(()=>{void reload()},[api]);
  async function mark(item:Item,mastered:boolean){try{await api(`/review-block/${item.questionId}`,{method:'PATCH',body:JSON.stringify({mastered})});await reload()}catch(e:any){setError(e.message||'No se pudo actualizar la pregunta')}}
  async function remove(item:Item){try{await api(`/review-block/${item.questionId}`,{method:'DELETE'});await reload()}catch(e:any){setError(e.message||'No se pudo quitar la pregunta')}}
  async function start(){try{const data=await api('/attempts',{method:'POST',body:JSON.stringify({kind:mode,questionCount:mode==='ONE_BY_ONE'?1:questionCount,reviewBlockOnly:true})});sessionStorage.setItem('practiceKind',mode);sessionStorage.setItem('practiceLicense','PER');sessionStorage.setItem('practiceSource','REVIEW_BLOCK');sessionStorage.setItem('questions',JSON.stringify(data.questions));navigate(`/attempt/${data.attemptId}`)}catch(e:any){setError(e.message||'No se pudo iniciar el repaso')}}
  const active=items.filter(item=>!item.masteredAt),mastered=items.filter(item=>item.masteredAt);
  return <section className={embedded?"review-block-page review-block-embedded":"content review-block-page"}>
    <div className="eyebrow">TU REPASO PERSONAL</div><h1>Bloque de repaso</h1><p className="review-block-intro">Guarda aquí las preguntas que te cuestan. Márcalas como aprendidas cuando ya te las sepas.</p>
    <section className="review-progress card"><div className="review-progress-copy"><b>{progress.mastered} de {progress.total} dominadas</b><span>{progress.active} pendientes de repaso</span></div><progress value={progress.mastered} max={Math.max(progress.total,1)}/><strong>{progress.progress}%</strong></section>
    <section className="review-start card"><div><b>Practicar este bloque</b><span>Las preguntas dominadas no se incluirán.</span></div><div className="review-start-controls"><select aria-label="Modo de repaso" value={mode} onChange={e=>setMode(e.target.value as 'ONE_BY_ONE'|'ROUND')}><option value="ONE_BY_ONE">Una a una</option><option value="ROUND">Ronda</option></select>{mode==='ROUND'&&<select aria-label="Número de preguntas" value={questionCount} onChange={e=>setQuestionCount(Number(e.target.value))}>{[5,10,20,40].map(n=><option key={n} value={n}>{n} preguntas</option>)}</select>}<button className="primary" disabled={!progress.active} onClick={()=>void start()}>Empezar repaso</button></div></section>
    {error&&<div className="error-inline" role="alert">{error}</div>}
    {loading?<p>Cargando bloque…</p>:<>
      <div className="review-block-section-title"><h2>Por repasar</h2><span>{active.length}</span></div>
      {active.length?active.map(item=><article className="review-block-item card" key={item.questionId}><div><small>{item.question.exam.license} · {item.question.exam.title} · Pregunta {item.question.number}</small><p>{item.question.prompt}</p></div><div className="review-block-actions"><button className="outline" onClick={()=>void mark(item,true)}>Ya me la sé</button><button className="text-button" onClick={()=>void remove(item)}>Quitar</button></div></article>):<p className="empty">Todavía no tienes preguntas en el bloque.</p>}
      {mastered.length>0&&<><div className="review-block-section-title"><h2>Ya me las sé</h2><span>{mastered.length}</span></div>{mastered.map(item=><article className="review-block-item card mastered" key={item.questionId}><div><small>{item.question.exam.license} · {item.question.exam.title} · Pregunta {item.question.number}</small><p>{item.question.prompt}</p></div><div className="review-block-actions"><button className="outline" onClick={()=>void mark(item,false)}>Volver a repasar</button><button className="text-button" onClick={()=>void remove(item)}>Quitar</button></div></article>)}</>}
    </>}
  </section>;
}

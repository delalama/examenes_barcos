import { useEffect, useMemo, useRef, useState } from "react";
import "./admin-review.css";
import "./question-images.css";
import "./review-badges.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
type Status = "PENDING_REVIEW" | "VALIDATED" | "REJECTED";
type ReviewItem = {
  sha256: string; filename: string; number: number; prompt: string; options: Record<string,string>;
  answer: string | null; answerSource: string | null; confidence: number; startPage: number | null;
  endPage: number | null; rawText: string | null; warnings: string[]; metadata: Record<string,any>;
  sourcePaths: string[]; reviewStatus: Status; reviewerNote: string; updatedAt: string | null; imagePath?:string|null; imageReviewStatus:string; validationMethod?:string|null; probableAnswerError?:boolean; officialAnswerCandidates?:string[];
};
type Api = (path:string, init?:RequestInit) => Promise<any>;

export default function AdminReview({ api, token }: { api:Api; token:string }) {
  const [items,setItems]=useState<ReviewItem[]>([]),[counts,setCounts]=useState({total:0,pending:0,validated:0,rejected:0,imagePending:0,imageAttached:0,autoValidated:0,probableAnswerErrors:0});
  const [status,setStatus]=useState("pending"),[search,setSearch]=useState(""),[selectedId,setSelectedId]=useState("");
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [prompt,setPrompt]=useState(""),[options,setOptions]=useState<Record<string,string>>({}),[answer,setAnswer]=useState<string|null>(null),[note,setNote]=useState("");
  const [pdfUrl,setPdfUrl]=useState("");
  const [cropMode,setCropMode]=useState(false),[cropPage,setCropPage]=useState(1),[pagePreview,setPagePreview]=useState(""),[crop,setCrop]=useState<{x:number;y:number;width:number;height:number}|null>(null),[imageSaving,setImageSaving]=useState(false),[imageSaved,setImageSaved]=useState(false);
  const cropCanvas=useRef<HTMLDivElement>(null),dragStart=useRef<{x:number;y:number}|null>(null);

  async function reload(nextStatus=status) {
    setLoading(true);setError("");
    try { const result=await api(`/admin/ocr-review?status=${nextStatus}`);setItems(result.items);setCounts(result.counts);setSelectedId((current:string)=>result.items.some((i:ReviewItem)=>key(i)===current)?current:(result.items[0]?key(result.items[0]):"")); }
    catch(e:any){setError(e.message||"No se pudo cargar la cola de revisión")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void reload(status)},[status,api]);
  const key=(item:ReviewItem)=>`${item.sha256}:${item.number}`;
  const selected=items.find((item)=>key(item)===selectedId)||items[0];
  useEffect(()=>{if(!selected)return;setPrompt(selected.prompt);setOptions({...selected.options});setAnswer(selected.answer);setNote(selected.reviewerNote||"");setCropMode(false);setCrop(null);setImageSaved(false);setCropPage(selected.startPage||1)},[selected?.sha256,selected?.number]);
  useEffect(()=>{
    if(!selected){setPdfUrl("");return}
    let objectUrl="";const controller=new AbortController();
    fetch(`${API}/admin/ocr-review/${selected.sha256}/pdf`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async(response)=>{if(!response.ok)throw new Error("No se pudo abrir el PDF original");return response.blob()})
      .then((blob)=>{objectUrl=URL.createObjectURL(blob);setPdfUrl(objectUrl)})
      .catch((e)=>{if(e.name!=="AbortError")setPdfUrl("")});
    return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[selected?.sha256,token]);
  useEffect(()=>{
    if(!selected||!cropMode){setPagePreview("");return}
    let objectUrl="";const controller=new AbortController();
    fetch(`${API}/admin/ocr-review/${selected.sha256}/page/${cropPage}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async(response)=>{if(!response.ok)throw new Error("No se pudo renderizar la página");return response.blob()})
      .then((blob)=>{objectUrl=URL.createObjectURL(blob);setPagePreview(objectUrl)})
      .catch((e)=>{if(e.name!=="AbortError")setError(e.message)});
    return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[selected?.sha256,cropPage,cropMode,token]);
  const filtered=useMemo(()=>{const q=search.trim().toLocaleLowerCase("es");return items.filter((item)=>!q||`${item.filename} ${item.prompt} ${item.number} ${item.metadata?.license||""} ${item.metadata?.island||""}`.toLocaleLowerCase("es").includes(q))},[items,search]);

  async function save(nextStatus:Status) {
    if(!selected)return;setSaving(true);setError("");
    try {
      await api(`/admin/ocr-review/${selected.sha256}/${selected.number}`,{method:"PATCH",body:JSON.stringify({prompt,options,answer,status:nextStatus,reviewerNote:note})});
      await reload(status);
    } catch(e:any){setError(e.message||"No se pudo guardar la corrección")} finally{setSaving(false)}
  }
  function cropPosition(event:React.PointerEvent<HTMLDivElement>){const rect=event.currentTarget.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width)),y:Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height))}}
  function beginCrop(event:React.PointerEvent<HTMLDivElement>){if(!pagePreview)return;event.currentTarget.setPointerCapture(event.pointerId);const point=cropPosition(event);dragStart.current=point;setCrop({x:point.x,y:point.y,width:0,height:0})}
  function moveCrop(event:React.PointerEvent<HTMLDivElement>){if(!dragStart.current)return;const point=cropPosition(event),start=dragStart.current;setCrop({x:Math.min(start.x,point.x),y:Math.min(start.y,point.y),width:Math.abs(point.x-start.x),height:Math.abs(point.y-start.y)})}
  function endCrop(event:React.PointerEvent<HTMLDivElement>){moveCrop(event);dragStart.current=null}
  async function saveImage(){if(!selected||!crop)return;setImageSaving(true);setError("");try{await api(`/admin/ocr-review/${selected.sha256}/${selected.number}/image`,{method:"POST",body:JSON.stringify({page:cropPage,crop})});setImageSaved(true);await reload(status)}catch(e:any){setError(e.message||"No se pudo asociar la imagen")}finally{setImageSaving(false)}}
  async function markNoImage(){if(!selected)return;setImageSaving(true);setError("");try{await api(`/admin/ocr-review/${selected.sha256}/${selected.number}`,{method:"PATCH",body:JSON.stringify({prompt,options,answer,status:selected.reviewStatus,reviewerNote:note,imageReviewStatus:"NOT_REQUIRED"})});setCropMode(false);await reload(status)}catch(e:any){setError(e.message||"No se pudo guardar la decisión sobre la imagen")}finally{setImageSaving(false)}}

  return <div className="admin-review-page">
    <div className="admin-review-heading"><div><div className="eyebrow">ADMINISTRACIÓN · IMPORTADOR</div><h1>Revisión de OCR</h1><p>Compara cada extracción con el PDF original y corrige el texto o la respuesta antes de importarla.</p></div><button className="outline" onClick={()=>void reload()}>Actualizar cola</button></div>
    <div className="review-stats"><div><b>{counts.pending}</b><span>Pendientes de texto</span></div><div><b>{counts.imagePending}</b><span>Imágenes dudosas · {counts.imageAttached} vinculadas</span></div><div><b>{counts.autoValidated}</b><span>Validadas automáticamente</span></div><div><b>{counts.total}</b><span>Preguntas extraídas</span></div></div>
    {error&&<div className="review-error" role="alert">{error}</div>}
    <div className="review-toolbar"><div className="review-tabs">{[["pending","Texto pendiente"],["answer-errors","Posibles erróneas ("+counts.probableAnswerErrors+")"],["images","Imágenes dudosas"],["validated","Revisadas"],["rejected","Descartadas"],["all","Todas las dudas"]].map(([value,label])=><button key={value} className={status===value?"active":""} onClick={()=>setStatus(value)}>{label}</button>)}</div><input aria-label="Buscar pregunta" placeholder="Buscar PDF o texto…" value={search} onChange={(e)=>setSearch(e.target.value)}/></div>
    <div className="review-workspace">
      <aside className="review-list" aria-label="Preguntas pendientes">
        {loading?<p className="review-empty">Cargando preguntas…</p>:filtered.length?filtered.map((item)=> <button key={key(item)} className={`review-list-item ${selected&&key(selected)===key(item)?"current":""}`} onClick={()=>setSelectedId(key(item))}>
          <span className={`status-dot ${item.imageReviewStatus==="PENDING_REVIEW"?"pending":item.reviewStatus.toLowerCase()}`}/><span className="review-list-copy"><b>{item.filename}</b><span>Pregunta {item.number} · {item.metadata?.license||"Titulación pendiente"} · {item.metadata?.year||"Año pendiente"}</span><small>{item.imageReviewStatus==="PENDING_REVIEW"?"Imagen sin asociación segura":item.warnings[0]||"Respuesta pendiente de revisar"}</small></span>
        </button>):<p className="review-empty">No hay preguntas en esta vista.</p>}
      </aside>
      {selected?<section className="review-editor">
         <div className="review-context"><div><span className="eyebrow">{selected.metadata?.island||"Isla sin confirmar"} · {selected.metadata?.license||"Titulación sin confirmar"}</span><h2>{selected.filename}</h2><p>Pregunta {selected.number} · {selected.metadata?.session||"Convocatoria sin confirmar"} {selected.metadata?.year||""} · Confianza OCR {Math.round((selected.confidence||0)*100)}%</p></div><div className="review-context-badges"><span className={`review-status-badge ${selected.reviewStatus.toLowerCase()}`}>{selected.reviewStatus==="PENDING_REVIEW"?"Texto pendiente":selected.reviewStatus==="VALIDATED"?(selected.validationMethod?"Texto validado automáticamente":"Texto revisado"):"Descartada"}</span>{selected.imageReviewStatus!=="NONE"&&<span className={`review-status-badge ${selected.imageReviewStatus==="PENDING_REVIEW"?"pending":selected.imageReviewStatus==="NOT_REQUIRED"?"rejected":"validated"}`}>{selected.imageReviewStatus==="PENDING_REVIEW"?"Imagen por revisar":selected.imageReviewStatus==="AUTO_ATTACHED"?"Imagen vinculada automáticamente":selected.imageReviewStatus==="NOT_REQUIRED"?"Sin imagen":"Imagen vinculada"}</span>}</div></div>
        {selected.probableAnswerError&&<div className="probable-answer-warning" role="alert"><b>Respuesta del PDF probablemente errónea</b><span>El PDF marca como correctas las opciones {(selected.officialAnswerCandidates||[]).join(", ")}. Comprueba la respuesta en el original antes de validarla.</span></div>}
        {selected.imagePath&&<AttachedReviewImage item={selected} token={token}/>}
        <div className="review-columns">
          <div className="review-form">
            <label>Enunciado<textarea rows={5} value={prompt} onChange={(e)=>setPrompt(e.target.value)}/></label>
            <div className="answer-heading"><b>Opciones</b><span>Marca la respuesta oficial</span></div>
            {Object.entries(options).map(([letter,value])=><div className="answer-option" key={letter}><label className="answer-radio" title={`Marcar ${letter} como respuesta`}><input type="radio" name="correct-answer" checked={answer===letter} onChange={()=>setAnswer(letter)}/><b>{letter}</b></label><textarea aria-label={`Opción ${letter}`} rows={2} value={value} onChange={(e)=>setOptions((current)=>({...current,[letter]:e.target.value}))}/></div>)}
            <label className="no-answer"><input type="radio" name="correct-answer" checked={answer===null} onChange={()=>setAnswer(null)}/> El PDF no indica una respuesta correcta</label>
            <label>Nota de revisión<textarea rows={2} placeholder="Apunta por qué has cambiado algo o qué falta comprobar…" value={note} onChange={(e)=>setNote(e.target.value)}/></label>
            <details className="raw-text"><summary>Texto detectado por el OCR</summary><pre>{selected.rawText||"No hay texto OCR guardado."}</pre><p>{selected.warnings.join(" · ")}</p></details>
            <div className="review-actions"><button className="outline" disabled={saving} onClick={()=>void save("PENDING_REVIEW")}>Guardar pendiente</button><button className="reject-button" disabled={saving} onClick={()=>void save("REJECTED")}>Descartar</button><button className="primary" disabled={saving||!prompt.trim()||!Object.values(options).every((v)=>v.trim())} onClick={()=>void save("VALIDATED")}>{saving?"Guardando…":"Guardar como revisada"}</button></div>
          </div>
          <div className="pdf-panel"><div className="pdf-panel-head"><div><b>{cropMode?"Selecciona el recorte de esta pregunta":"PDF original"}</b><span>Página {selected.startPage||1}{selected.endPage&&selected.endPage!==selected.startPage?`–${selected.endPage}`:""}</span></div><div className="pdf-panel-tools">{selected.imagePath&&<small className="image-attached">Imagen asociada ✓</small>}<button className="outline crop-toggle" onClick={()=>{setCropMode((value)=>!value);setCrop(null)}}>{cropMode?"Volver al PDF":"Asociar imagen"}</button></div></div>{cropMode?<div className="crop-workspace">{selected.endPage&&selected.startPage&&selected.endPage>selected.startPage&&<label>Página <select value={cropPage} onChange={(e)=>{setCropPage(Number(e.target.value));setCrop(null)}}>{Array.from({length:selected.endPage-selected.startPage+1},(_,index)=>selected.startPage!+index).map((page)=><option key={page} value={page}>{page}</option>)}</select></label>}{pagePreview?<div ref={cropCanvas} className="crop-canvas" onPointerDown={beginCrop} onPointerMove={moveCrop} onPointerUp={endCrop} onPointerCancel={()=>{dragStart.current=null}}><img src={pagePreview} alt="Página del PDF: arrastra para seleccionar solo la imagen de la pregunta" draggable={false}/>{crop&&<div className="crop-selection" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}/>}</div>:<div className="pdf-unavailable">Renderizando página…</div>}<div className="crop-help">Arrastra un rectángulo alrededor del gráfico o imagen que acompaña a la pregunta. No incluyas el resto de la página ni la respuesta oficial.</div><div className="image-review-actions"><button className="reject-button" disabled={imageSaving} onClick={()=>void markNoImage()}>Esta pregunta no necesita imagen</button><button className="primary" disabled={!crop||crop.width<.015||crop.height<.015||imageSaving} onClick={()=>void saveImage()}>{imageSaving?"Guardando recorte…":imageSaved?"Imagen asociada ✓":"Guardar imagen de esta pregunta"}</button></div></div>:<>{pdfUrl?<iframe title={`PDF original: ${selected.filename}`} src={`${pdfUrl}#page=${selected.startPage||1}&zoom=page-width`}/>:<div className="pdf-unavailable">No se pudo cargar el PDF de origen.</div>}</>}</div>
        </div>
      </section>:<section className="review-no-selection">{loading?"":"Selecciona una pregunta para revisarla."}</section>}
    </div>
  </div>;
}

function AttachedReviewImage({item,token}:{item:ReviewItem;token:string}) {
  const [src,setSrc]=useState("");
  useEffect(()=>{
    let objectUrl="";const controller=new AbortController();
    fetch(`${API}/admin/ocr-review/${item.sha256}/${item.number}/image`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async(response)=>{if(!response.ok)throw new Error("Imagen no disponible");return response.blob()})
      .then((blob)=>{objectUrl=URL.createObjectURL(blob);setSrc(objectUrl)})
      .catch(()=>setSrc(""));
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[item.sha256,item.number,item.imagePath,token]);
  return src?<div className="attached-review-image"><span>Imagen asociada actualmente</span><img src={src} alt={`Imagen asociada a la pregunta ${item.number}`}/></div>:null;
}

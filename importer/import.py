"""Conservatively extract exam questions; never guesses the official answer."""
import argparse, hashlib, json, re, unicodedata, sys
from pathlib import Path
import pymupdf as fitz

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")

ISLANDS = {"mallorca":"Mallorca", "menorca":"Menorca", "eivissa":"Ibiza", "ibiza":"Ibiza"}
LICENSES = ("PNB", "PER", "PY", "CY", "CR")
POSSIBLE_ANSWER_ERROR_QUESTIONS = (
    ("Menorca/2018/diciembre/PER/PER_2n_torn_Menorca.pdf", 11),
    ("Menorca/2018/diciembre/PNB/PNB_Menorca.pdf", 11),
    ("Mallorca/2026/septiembre/PER/PER_complet_+_especifics_1T_Palma_model_A.pdf", 18),
    ("Mallorca/2026/septiembre/PNB/PNB_Palma_model_A.pdf", 18),
)
MONTHS = {
    "enero": ("enero",), "febrero": ("febrero",), "marzo": ("marzo", "març"),
    "abril": ("abril",), "mayo": ("mayo",), "junio": ("junio", "juny"),
    "julio": ("julio", "juliol"), "agosto": ("agosto",),
    "septiembre": ("septiembre", "setembre", "setiembre"), "octubre": ("octubre",),
    "noviembre": ("noviembre",), "diciembre": ("diciembre", "desembre"),
}

def plain(value: str):
    return "".join(c for c in unicodedata.normalize("NFD", value.casefold()) if unicodedata.category(c) != "Mn")

def metadata(path: Path, text: str):
    hay = " ".join([str(path), text[:3000]]).casefold()
    title = plain(f"{path.stem} {text[:500]}")
    island_source = plain(f"{' '.join(path.parts[:-1])} {path.stem} {text[:300]}")
    island_hits=set()
    if re.search(r"(?<![a-z])(?:mallorca|palma)(?![a-z])", island_source): island_hits.add("Mallorca")
    if re.search(r"(?<![a-z])(?:menorca|mao|mahon)(?![a-z])", island_source): island_hits.add("Menorca")
    if re.search(r"(?<![a-z])(?:eivissa|ibiza)(?![a-z])", island_source): island_hits.add("Ibiza")
    island=next(iter(island_hits)) if len(island_hits)==1 else None
    license_context=" ".join((*path.parts[:-1],path.stem)).upper()
    license_ = next((x for x in LICENSES if re.search(rf"(?<![A-Z]){x}(?![A-Z])", license_context)), None)
    if license_ is None:
        if re.search(r"(?<![a-z])(?:capita|capitan|capit�)[_\s-]+(?:de[_\s-]+)?(?:iot|yate)(?![a-z])", title): license_ = "CY"
        elif re.search(r"(?<![a-z])(?:patro|patron)[_\s-]+(?:de[_\s-]+)?(?:iot|yate)(?![a-z])", title): license_ = "PY"
        elif re.search(r"(?<![a-z])per(?![a-z])", title): license_ = "PER"
        elif re.search(r"(?<![a-z])pnb(?![a-z])", title): license_ = "PNB"
    # CR is the folder label requested for Capitán de Yate (CY in the app/catalog).
    if license_ == "CR": license_ = "CY"
    year = re.search(r"\b(20(?:1[7-9]|2[0-6]))\b", hay)
    # Prefer an explicit month directory; otherwise use the PDF's opening metadata.
    path_parts = [plain(part) for part in path.parts]
    session = None
    for canonical, aliases in MONTHS.items():
        if any(part in [plain(a) for a in aliases] for part in path_parts):
            session = canonical
            break
    if session is None:
        header = plain(re.split(r"(?m)^\s*\d{1,3}[.)]\s+", text, maxsplit=1)[0])
        convocatoria=re.search(r"convocat\w{0,8}\s*[:\-]?\s*([^\n]{0,120})",header)
        header=convocatoria.group(1) if convocatoria else ""
        for canonical, aliases in MONTHS.items():
            if any(re.search(rf"\b{re.escape(plain(alias))}\b", header) for alias in aliases):
                session = canonical
                break
    if session is None and any(part in ("marzo-abril", "marzo_abril", "marzo abril") for part in path_parts):
        session = "marzo-abril"
    model_context=plain(f"{path.stem} {text[:600]}")
    model_matches=re.findall(r"(?<![a-z])(?:modelo|model)[^:\n]{0,18}[:=_-]\s*([a-e])(?![a-z])",model_context,re.I)
    has_multiple_models=bool(re.search(r"(?<![a-z])(?:modelo|model)[^:\n]{0,18}[:=_-]\s*[a-e](?![a-z])[_\s]*(?:y|i|and|&)[_\s]*[a-e](?![a-z])",model_context,re.I))
    model=model_matches[0].upper() if len(set(x.upper() for x in model_matches))==1 and not has_multiple_models else None
    corrected = bool(re.search(r"res(?:postes|puestas)?\b", path.name, re.I) or re.search(r"(?:resposta|respuesta)\s+correcta", plain(text[:5000])))
    return {"island": island, "license": license_, "year": int(year.group(1)) if year else None, "session": session,
            "model": model, "corrected": corrected}

def split_questions(text: str, page_offsets=None):
    starts=list(re.finditer(r"(?m)^[ \t]*(\d{1,2})[.)][ \t]+(?=\S)",text))
    out=[]
    for i,m in enumerate(starts):
        end=starts[i+1].start() if i+1<len(starts) else len(text)
        body=text[m.end():end]
        raw_body=body
        answer_key_pattern=r"(?im)^[ \t]*(?:resposta|respuesta|respostes|respuestas)[ \t]+correct(?:a|es|as)[ \t]*:?[ \t]*(.*?)\s*$"
        answer_matches=list(re.finditer(answer_key_pattern,body))
        answer_values=[]
        for match in answer_matches:
            value=match.group(1).strip()
            if re.fullmatch(r"[A-D](?:\s*(?:(?:,|;|/|\+|&|\bi\b|\by\b|\band\b)\s*[A-D]))*\s*\.?",value,re.I):
                answer_values.extend(re.findall(r"[A-D]",value.upper()))
        answers=set(answer_values)
        body=re.sub(answer_key_pattern, "", body)
        body=re.sub(r"(?m)^[ \t]*\d{1,2}[ \t]*$", "", body).strip()
        option_marks=list(re.finditer(r"(?m)^[ \t]*([A-D])[ \t]*[:.)-][ \t]*",body))
        opts={}
        for oi,om in enumerate(option_marks):
            opt_end=option_marks[oi+1].start() if oi+1<len(option_marks) else len(body)
            value=re.sub(r"\s+", " ", body[om.end():opt_end]).strip()
            if value: opts[om.group(1).upper()]=value
        prompt=re.sub(r"\s+", " ", body[:option_marks[0].start()] if option_marks else body).strip()
        warnings=[]
        if not prompt or len(opts)<2: warnings.append("Pregunta incompleta o estructura de opciones no reconocida")
        if not answers: warnings.append("No se encontró una respuesta oficial explícita")
        multiple_official_answers=len(answers)>1
        if multiple_official_answers: warnings.append(f"El PDF indica varias respuestas oficiales ({', '.join(sorted(answers))}); requiere revisión")
        if "\ufffd" in body: warnings.append("El texto extraído contiene caracteres de sustitución; revisar contra el PDF")
        correct=next(iter(answers)) if len(answers)==1 else None
        start_page=end_page=None
        if page_offsets:
            start_page=next((n for n,(a,b) in enumerate(page_offsets,1) if a<=m.start()<b),None)
            end_page=next((n for n,(a,b) in enumerate(page_offsets,1) if a<=max(m.start(),end-1)<b),start_page)
        confidence=0.99 if prompt and len(opts)>=3 and (correct or multiple_official_answers) else 0.0
        if "\ufffd" in body and confidence: confidence=0.65
        out.append({"number":int(m.group(1)),"prompt":prompt,"options":opts,"status":"PENDING_REVIEW",
                    "answer":correct,"answerSource":"OFFICIAL_PDF" if correct else ("OFFICIAL_PDF_MULTIPLE" if multiple_official_answers else None),
                    "officialAnswerCandidates":sorted(answers) if multiple_official_answers else [],
                    "probableAnswerError":False,
                    "confidence":confidence,
                    "startPage":start_page,"endPage":end_page,"rawText":raw_body,"warnings":warnings})
    return out

def process(path: Path):
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    doc=fitz.open(path)
    pages=[page.get_text("text", sort=True) for page in doc]
    offsets=[]; cursor=0
    for page_text in pages:
        offsets.append((cursor,cursor+len(page_text)))
        cursor += len(page_text)+1
    joined="\n".join(pages)
    qs=split_questions(joined,offsets)
    image_pages=[n for n,page in enumerate(doc,1) if page.get_images(full=True)]
    for q in qs:
        q["containsImagePage"]=any(q.get("startPage",0)<=n<=q.get("endPage",0) for n in image_pages)
        if q["containsImagePage"]:
            q["warnings"].append("La página asociada contiene imágenes; comprobar si son necesarias para responder")
    meta=metadata(path,joined)
    if not meta["license"]: meta["warnings"]=["Titulación pendiente de revisión"]
    else: meta["warnings"]=[]
    if not joined.strip(): meta["warnings"].append("PDF sin texto extraíble; OCR pendiente")
    return {"source":path.name,"sha256":digest,"pages":len(pages),"metadata":meta,"questions":qs}

def question_marker_positions(page):
    positions = {}
    data = page.get_text("dict", sort=True)
    for block in data["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            marker = re.match(r"^[ \t]*(\d{1,2})[.)][ \t]+(?=\S)", text)
            if marker:
                positions.setdefault(int(marker.group(1)), line["bbox"][1])
    return positions

def save_image_png(document, xref: int, target: Path):
    try:
        image = document.extract_image(xref)
        if not image:
            return False
        pixmap = fitz.Pixmap(image["image"])
        if pixmap.n - pixmap.alpha > 3:
            pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
        target.parent.mkdir(parents=True, exist_ok=True)
        pixmap.save(target)
        return True
    except Exception:
        target.unlink(missing_ok=True)
        return False

def associate_question_images(doc, questions, image_dir: Path | None, digest: str):
    visual_reference = re.compile(r"\b(?:imagen|figura|gr[aá]fico|tabla|esquema|dibujo|carta|representaci[oó]n)\b", re.I)
    questions_by_page = {}
    for question in questions:
        question["imageReviewStatus"] = "NONE"
        page_number = question.get("startPage")
        if page_number and page_number == question.get("endPage"):
            questions_by_page.setdefault(page_number, []).append(question)

    for page_number, page_questions in questions_by_page.items():
        page = doc[page_number - 1]
        markers = question_marker_positions(page)
        ordered = sorted(page_questions, key=lambda question: (markers.get(question["number"], float("inf")), question["number"]))
        image_placements = []
        seen = set()
        for item in page.get_images(full=True):
            xref = item[0]
            if xref in seen:
                continue
            seen.add(xref)
            for rect in page.get_image_rects(xref):
                area = rect.width * rect.height
                page_area = page.rect.width * page.rect.height
                if area < page_area * 0.002 or area > page_area * 0.72:
                    continue
                image_placements.append((xref, rect))

        for index, question in enumerate(ordered):
            top = markers.get(question["number"])
            if top is None:
                if visual_reference.search(question.get("prompt", "")):
                    question["imageReviewStatus"] = "PENDING_REVIEW"
                    question["warnings"].append("Imagen/figura posible; no se pudo localizar con seguridad en la página")
                continue
            next_tops = [markers.get(item["number"]) for item in ordered[index + 1:]]
            bottom = min((value for value in next_tops if value is not None), default=page.rect.y1)
            candidates = [(xref, rect) for xref, rect in image_placements
                          if rect.y1 > top and rect.y0 < bottom
                          and rect.y0 >= top - page.rect.height * 0.015
                          and rect.y1 <= bottom + page.rect.height * 0.015]
            if len(candidates) == 1 and image_dir:
                xref, _rect = candidates[0]
                image_name = f"{digest}-{question['number']}-auto.png"
                if save_image_png(doc, xref, image_dir / image_name):
                    question["imagePath"] = image_name
                    question["imageReviewStatus"] = "AUTO_ATTACHED"
                    question["imageAssociation"] = "single embedded image inside this question's page region"
                    continue
            if candidates or visual_reference.search(question.get("prompt", "")):
                question["imageReviewStatus"] = "PENDING_REVIEW"
                question["imageCandidates"] = len(candidates)
                question["warnings"].append("Imagen/figura posible sin una asociación automática segura; revisar en Admin")
            else:
                question["imageReviewStatus"] = "NONE"

    for question in questions:
        if (not question.get("startPage") or question.get("startPage") != question.get("endPage")) and visual_reference.search(question.get("prompt", "")):
            question["imageReviewStatus"] = "PENDING_REVIEW"
            question["warnings"].append("Imagen/figura posible en varias páginas; revisar asociación en Admin")

    by_number = {question["number"]: question for question in questions}
    for question in questions:
        if re.search(r"\b(?:pregunta|figura|imagen)\s+anterior\b", question.get("prompt", ""), re.I):
            previous = by_number.get(question["number"] - 1)
            if previous and previous.get("imagePath"):
                question["imagePath"] = previous["imagePath"]
                question["imageReviewStatus"] = "AUTO_ATTACHED"
                question["imageAssociation"] = "question explicitly refers to the previous question's image"
                question["warnings"] = [warning for warning in question["warnings"] if "Imagen/figura posible" not in warning]

    for question in questions:
        question["containsImagePage"] = question.get("imageReviewStatus") != "NONE"
        content_warnings = [warning for warning in question.get("warnings", [])
                            if not warning.startswith("Imagen/figura posible")
                            and not warning.startswith("El PDF indica varias respuestas")]
        has_official_key = (
            question.get("answerSource") == "OFFICIAL_PDF"
            and question.get("answer") in question.get("options", {})
        ) or (
            question.get("probableAnswerError")
            and question.get("answerSource") == "OFFICIAL_PDF_MULTIPLE"
            and len(question.get("officialAnswerCandidates", [])) > 1
        )
        clear_content = (
            question.get("confidence", 0) >= 0.95
            and has_official_key
            and set(question.get("options", {})) == {"A", "B", "C", "D"}
            and all(value.strip() for value in question.get("options", {}).values())
            and len(question.get("prompt", "").strip()) >= 12
            and not content_warnings
            and "\ufffd" not in question.get("prompt", "")
            and all("\ufffd" not in value for value in question.get("options", {}).values())
        )
        question["status"] = "VALIDATED" if clear_content else "PENDING_REVIEW"
        question["validationMethod"] = (
            "AUTO_OFFICIAL_MULTIPLE_ANSWER_REQUIRES_NOTICE" if clear_content and question.get("probableAnswerError")
            else "AUTO_HIGH_CONFIDENCE_OFFICIAL_ANSWER" if clear_content else None
        )

def process(path: Path, image_dir: Path | None = None):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    doc = fitz.open(path)
    pages = [page.get_text("text", sort=True) for page in doc]
    offsets = []
    cursor = 0
    for page_text in pages:
        offsets.append((cursor, cursor + len(page_text)))
        cursor += len(page_text) + 1
    joined = "\n".join(pages)
    questions = split_questions(joined, offsets)
    source_path=path.as_posix()
    for question in questions:
        is_confirmed_issue=any(source_path.endswith(suffix) and question["number"]==number for suffix,number in POSSIBLE_ANSWER_ERROR_QUESTIONS)
        if is_confirmed_issue and question.get("answerSource")=="OFFICIAL_PDF_MULTIPLE":
            question["probableAnswerError"]=True
            question["warnings"]=[warning for warning in question["warnings"] if not warning.startswith("El PDF indica varias respuestas oficiales")]
            question["warnings"].append(f"El PDF indica varias respuestas ({', '.join(question['officialAnswerCandidates'])}); probablemente errónea. Revisar contra el original")
    associate_question_images(doc, questions, image_dir, digest)
    meta = metadata(path, joined)
    if not meta["license"]:
        meta["warnings"] = ["Titulación pendiente de revisión"]
    else:
        meta["warnings"] = []
    if not joined.strip():
        meta["warnings"].append("PDF sin texto extraíble; OCR pendiente")
    result = {"source": path.name, "sha256": digest, "pages": len(pages), "metadata": meta, "questions": questions}
    doc.close()
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("root",type=Path); ap.add_argument("--out",type=Path,default=Path("importer/out")); ap.add_argument("--limit",type=int,default=None,help="Máximo de PDFs para una prueba de importación"); args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    seen={}
    pdfs=sorted(args.root.rglob("*.pdf"))
    if args.limit is not None: pdfs=pdfs[:args.limit]
    for pdf in pdfs:
        try:
            item=process(pdf, args.out/"images")
            if item["sha256"] in seen: item["duplicateOf"]=seen[item["sha256"]]
            else: seen[item["sha256"]]=str(pdf)
            target=args.out/pdf.relative_to(args.root).with_suffix(".json")
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text(json.dumps(item,ensure_ascii=False,indent=2),encoding="utf-8")
            print(f"{pdf}: {len(item['questions'])} pregunta(s) -> revisión")
        except Exception as exc: print(f"ERROR {pdf}: {exc}")
if __name__=="__main__": main()

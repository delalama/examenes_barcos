"""Create deduplicated, review-only JSON staging for the exam PDF collection."""
import argparse, csv, hashlib, json, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from importlib.machinery import SourceFileLoader

import pymupdf

extractor=SourceFileLoader("exam_import",str(Path(__file__).with_name("import.py"))).load_module()
ISLAND_ALIASES={
    "Mallorca":("mallorca","mall","palma"),
    "Menorca":("menorca","men","mao","mahon"),
    "Ibiza":("ibiza","eivissa","eivisssa","eiv"),
}
LICENSES=("PNB","PER","PY","CY")

def plain(s):
    return "".join(c for c in unicodedata.normalize("NFD",s.casefold()) if unicodedata.category(c)!="Mn")

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
    return h.hexdigest()

def island_candidates(paths, filename, text):
    source=plain(" ".join([filename,text[:500]]))
    found=set()
    for island,aliases in ISLAND_ALIASES.items():
        if any(re.search(rf"(?<![a-z]){re.escape(alias)}(?![a-z])",source) for alias in aliases):found.add(island)
    if re.search(r"(?<![a-z])illes(?![a-z])",source):found.update(ISLAND_ALIASES)
    for path in paths:
        for part in path.parts:
            if part in ISLAND_ALIASES:found.add(part)
    return sorted(found)

def license_candidates(paths, filename, metadata):
    source=" ".join([filename,*[part for p in paths for part in p.parts]]).upper()
    found={x for x in LICENSES if re.search(rf"(?<![A-Z]){x}(?![A-Z])",source)}
    if not found and metadata.get("license"):found.add(metadata["license"])
    # The user confirmed PEE-named source documents in the doubts queue are PER.
    if not found and re.search(r"(?<![A-Z])PEE(?![A-Z])",source):found.add("PER")
    return sorted(found)

def main():
    if hasattr(sys.stdout,"reconfigure"):sys.stdout.reconfigure(errors="replace")
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root",type=Path,default=Path("exams/pdfs"))
    ap.add_argument("--out",type=Path,default=Path("importer/out/bulk-analysis"))
    ap.add_argument("--limit",type=int,default=None,help="Limita el número de documentos únicos para una prueba")
    args=ap.parse_args()
    all_pdfs=sorted(args.root.rglob("*.pdf"))
    excluded=[p for p in all_pdfs if "marees" in p.name.casefold()]
    grouped=defaultdict(list)
    for p in all_pdfs:
        if p not in excluded:grouped[digest(p)].append(p)
    groups=sorted(grouped.items(),key=lambda item:min(str(p) for p in item[1]))
    if args.limit is not None:groups=groups[:args.limit]
    docs_dir=args.out/"documents";docs_dir.mkdir(parents=True,exist_ok=True)
    doc_rows=[];review_rows=[];metadata_rows=[];errors=[]; totals=Counter()
    for ix,(sha,paths) in enumerate(groups,1):
        # Prefer a source/master path over its island-specific duplicate.
        canonical=sorted(paths,key=lambda p:("varias-islas" not in p.parts,len(p.parts),str(p)))[0]
        try:
            result=extractor.process(canonical,args.out/"images")
            with pymupdf.open(canonical) as pdf:
                first_text="\n".join(page.get_text("text",sort=True) for page in list(pdf)[:2])
                textless=not any(page.get_text("text").strip() for page in pdf)
            islands=island_candidates(paths,canonical.name,first_text)
            licenses=license_candidates(paths,canonical.name,result["metadata"])
            result["metadata"]["islands"]=islands
            result["metadata"]["island"]=islands[0] if len(islands)==1 else None
            result["metadata"]["licenses"]=licenses
            result["metadata"]["license"]=licenses[0] if len(licenses)==1 else None
            result["metadata"]["reviewRequired"]=True
            result["sourcePaths"]=[str(p.as_posix()) for p in sorted(paths)]
            result["sizeBytes"]=canonical.stat().st_size
            result["textless"]=textless
            result["questions"]=[{**q,"status":q.get("status","PENDING_REVIEW")} for q in result["questions"]]
            out=docs_dir/f"{sha}.json"
            out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
            qs=result["questions"]
            totals["documents"]+=1;totals["pages"]+=result["pages"]
            totals["questions"]+=len(qs)
            totals["validatedQuestions"]+=sum(q["status"]=="VALIDATED" for q in qs)
            totals["pendingQuestions"]+=sum(q["status"]=="PENDING_REVIEW" for q in qs)
            totals["probableAnswerErrors"]+=sum(q.get("probableAnswerError",False) for q in qs)
            totals["pendingImageQuestions"]+=sum(q.get("imageReviewStatus")=="PENDING_REVIEW" for q in qs)
            totals["autoAttachedImages"]+=sum(q.get("imageReviewStatus")=="AUTO_ATTACHED" for q in qs)
            totals["explicitAnswers"]+=sum(q["answer"] is not None for q in qs)
            totals["missingAnswers"]+=sum(q["answer"] is None for q in qs)
            totals["warnings"]+=sum(bool(q["warnings"]) for q in qs)
            totals["imageQuestions"]+=sum(q.get("containsImagePage",False) for q in qs)
            totals["textlessDocuments"]+=int(textless)
            totals["unresolvedIsland"]+=int(not islands)
            totals["multipleIslands"]+=int(len(islands)>1)
            totals["unresolvedLicense"]+=int(not licenses)
            totals["multipleLicenses"]+=int(len(licenses)>1)
            doc_rows.append({"sha256":sha,"filename":canonical.name,"sourceCount":len(paths),"pages":result["pages"],
                             "questions":len(qs),"explicitAnswers":sum(q["answer"] is not None for q in qs),
                             "islands":"|".join(islands),"licenses":"|".join(licenses),"year":result["metadata"].get("year"),
                             "session":result["metadata"].get("session"),"model":result["metadata"].get("model"),
                             "textless":textless,"json":str(out.as_posix())})
            if len(islands)!=1 or len(licenses)!=1 or not result["metadata"].get("year") or not result["metadata"].get("session"):
                metadata_rows.append({"sha256":sha,"filename":canonical.name,"sourcePaths":" | ".join(str(p.as_posix()) for p in sorted(paths)),
                                      "islands":"|".join(islands),"licenses":"|".join(licenses),
                                      "year":result["metadata"].get("year"),"session":result["metadata"].get("session"),"json":str(out.as_posix())})
            for q in qs:
                if q["status"]=="PENDING_REVIEW" or q.get("imageReviewStatus")=="PENDING_REVIEW" or q.get("probableAnswerError"):
                    review_rows.append({"sha256":sha,"filename":canonical.name,"question":q["number"],"prompt":q["prompt"],
                                        "options":json.dumps(q["options"],ensure_ascii=False),"answer":q["answer"],
                                        "answerSource":q["answerSource"],"confidence":q["confidence"],
                                        "startPage":q["startPage"],"endPage":q["endPage"],
                                        "status":q["status"],"imageReviewStatus":q.get("imageReviewStatus"),"imagePath":q.get("imagePath"),
                                        "validationMethod":q.get("validationMethod"),"warnings":" | ".join(q["warnings"]),"json":str(out.as_posix())})
            if ix%25==0 or ix==len(groups):print(f"Analizados {ix}/{len(groups)} documentos únicos",flush=True)
        except Exception as exc:
            errors.append({"sha256":sha,"path":str(canonical),"error":str(exc)})
            print(f"ERROR {canonical}: {exc}",flush=True)
    summary={"mode":"staging_only_no_database_writes","pdfFiles":len(all_pdfs),"excludedMarees":len(excluded),
             "eligiblePdfCopies":len(all_pdfs)-len(excluded),"uniqueDocumentsRequested":len(groups),
             "duplicateCopiesAmongEligible":max(0,len(all_pdfs)-len(excluded)-len(grouped)),
             "documentsProcessed":totals["documents"],"totals":dict(totals),"errors":errors}
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    with (args.out/"documents.csv").open("w",newline="",encoding="utf-8-sig") as f:
        writer=csv.DictWriter(f,fieldnames=list(doc_rows[0]) if doc_rows else ["sha256"])
        writer.writeheader();writer.writerows(doc_rows)
    with (args.out/"excluded-marees.csv").open("w",newline="",encoding="utf-8-sig") as f:
        writer=csv.writer(f);writer.writerow(["path"]);writer.writerows([[p.as_posix()] for p in excluded])
    with (args.out/"review-queue.csv").open("w",newline="",encoding="utf-8-sig") as f:
        fields=["sha256","filename","question","prompt","options","answer","answerSource","confidence","startPage","endPage","status","imageReviewStatus","imagePath","validationMethod","warnings","json"]
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(review_rows)
    with (args.out/"metadata-review.csv").open("w",newline="",encoding="utf-8-sig") as f:
        fields=["sha256","filename","sourcePaths","islands","licenses","year","session","json"]
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(metadata_rows)
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=="__main__":main()

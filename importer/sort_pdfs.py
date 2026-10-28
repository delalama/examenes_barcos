"""Conservatively move PDFs from the desorden inbox into the exam tree."""
import argparse, csv, hashlib, re, shutil, sys
from collections import Counter
from pathlib import Path
import pymupdf
from importlib.machinery import SourceFileLoader

meta_module=SourceFileLoader("exam_import",str(Path(__file__).with_name("import.py"))).load_module()

def matches(token: str, source: str) -> bool:
    return bool(re.search(rf"(?<![a-z]){re.escape(token)}(?![a-z])",source))

def classify(path: Path):
    with pymupdf.open(path) as doc:
        text="\n".join(page.get_text("text",sort=True) for page in list(doc)[:2])
    m=meta_module.metadata(path,text)
    stem=meta_module.plain(path.stem)
    island_source=stem
    island_hits=set()
    if any(matches(x,island_source) for x in ("mallorca","mall","palma")): island_hits.add("Mallorca")
    if any(matches(x,island_source) for x in ("menorca","men","mao","mahon")): island_hits.add("Menorca")
    if any(matches(x,island_source) for x in ("ibiza","eivissa","eivisssa","eiv")): island_hits.add("Ibiza")
    all_islands=matches("illes",island_source) or matches("illes",meta_module.plain(text[:300]))
    if not island_hits and m.get("island"): island_hits.add(m["island"])
    if len(island_hits)>1 or all_islands: island="varias-islas"
    elif len(island_hits)==1: island=next(iter(island_hits))
    else: island="sin-isla"

    codes=[x for x in ("PNB","PER","PY","CY") if re.search(rf"(?<![A-Z]){x}(?![A-Z])",path.stem.upper())]
    if "PEE" in stem and "PER" not in codes: codes.append("PER")
    if "CR" in codes and "CY" not in codes: codes.append("CY")
    if not codes:
        detected=m.get("license")
        if detected: codes=[detected]
        elif re.search(r"(?<![a-z])(?:capita|capitan|capit�)[_\s-]+(?:de[_\s-]+)?(?:iot|yate)(?![a-z])",stem): codes=["CY"]
        elif re.search(r"(?<![a-z])(?:patro|patron)[_\s-]+(?:de[_\s-]+)?(?:iot|yate)(?![a-z])",stem): codes=["PY"]
    codes=list(dict.fromkeys(codes))
    if len(codes)>1: license_="varias-titulaciones"
    elif codes: license_=codes[0]
    elif "moto" in stem: license_="fuera-de-alcance"
    else: license_="pendiente-revision"

    year=m.get("year")
    month=m.get("session")
    return {"island":island,"license":license_,"year":str(year) if year else "sin-año",
            "month":month or "sin-convocatoria","model":m.get("model"),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}

def main():
    if hasattr(sys.stdout,"reconfigure"): sys.stdout.reconfigure(errors="replace")
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source",type=Path,default=Path("exams/pdfs/desorden"))
    ap.add_argument("--destination",type=Path,default=Path("exams/pdfs"))
    ap.add_argument("--manifest",type=Path,default=Path("importer/out/sort-manifest.csv"))
    ap.add_argument("--apply",action="store_true",help="Mover los PDFs; sin esta opción solo crea un plan")
    args=ap.parse_args()
    plans=[]; counts=Counter()
    for src in sorted(p for p in args.source.rglob("*.pdf") if "dudas" not in p.relative_to(args.source).parts):
        md=classify(src)
        dest=args.destination/md["island"]/md["year"]/md["month"]/md["license"]/src.name
        if dest.exists(): dest=dest.with_name(f"{dest.stem}-{md['sha256'][:8]}{dest.suffix}")
        plans.append({"source":str(src),"destination":str(dest),**md})
        counts[(md["island"],md["license"])]+=1
    args.manifest.parent.mkdir(parents=True,exist_ok=True)
    with args.manifest.open("w",newline="",encoding="utf-8-sig") as f:
        writer=csv.DictWriter(f,fieldnames=["source","destination","island","year","month","license","model","sha256"])
        writer.writeheader(); writer.writerows(plans)
    print(f"Plan: {len(plans)} PDF(s); manifest: {args.manifest}")
    for (island,lic),n in sorted(counts.items()): print(f"{island:18} {lic:22} {n}")
    if args.apply:
        for item in plans:
            src=Path(item["source"]); dest=Path(item["destination"])
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.move(str(src),str(dest))
        print(f"Movidos: {len(plans)} PDF(s)")
    else: print("Vista previa solamente. Añade --apply para moverlos.")

if __name__=="__main__": main()

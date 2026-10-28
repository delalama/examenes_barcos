"""Apply the requested cleanup to the already classified PDF catalog."""
import csv, hashlib, re, shutil, unicodedata
from pathlib import Path

ROOT=Path("exams/pdfs")
MANIFEST=Path("importer/out/sort-manifest.csv")
ISLANDS={
    "Mallorca":("mallorca","mall","palma"),
    "Menorca":("menorca","men","mao","mahon"),
    "Ibiza":("ibiza","eivissa","eivisssa","eiv"),
}

def plain(value):
    return "".join(c for c in unicodedata.normalize("NFD",value.casefold()) if unicodedata.category(c)!="Mn")

def file_islands(filename):
    stem=plain(Path(filename).stem)
    found=[island for island,aliases in ISLANDS.items()
           if any(re.search(rf"(?<![a-z]){re.escape(alias)}(?![a-z])",stem) for alias in aliases)]
    if re.search(r"(?<![a-z])illes(?![a-z])",stem): return list(ISLANDS)
    return found

def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): h.update(block)
    return h.hexdigest()

def unique_target(target,digest):
    if not target.exists(): return target
    if sha(target)==digest: return target
    alternate=target.with_name(f"{target.stem}--{digest[:8]}{target.suffix}")
    n=2
    while alternate.exists() and sha(alternate)!=digest:
        alternate=target.with_name(f"{target.stem}--{digest[:8]}-{n}{target.suffix}"); n+=1
    return alternate

def prune_empty(directory):
    dirs=sorted((p for p in directory.rglob("*") if p.is_dir()),key=lambda p:len(p.parts),reverse=True)
    for d in dirs:
        for marker in d.glob(".gitkeep"):
            marker.unlink()
        if any(d.rglob("*.pdf")): continue
        if not any(d.iterdir()): d.rmdir()

def main():
    with MANIFEST.open(encoding="utf-8-sig",newline="") as f: rows=list(csv.DictReader(f))
    multi=[r for r in rows if r["island"]=="varias-islas"]
    motos=[Path(r["destination"]) for r in rows if r["license"]=="fuera-de-alcance"]
    pee=[p for p in ROOT.rglob("*.pdf") if re.search(r"(?<![A-Z])PEE(?![A-Z])",p.stem.upper())]
    operations=[]

    # Keep a record of the locations represented by each combined PDF, and copy it
    # with its original model/name into each indicated island. PEE copies stay flagged.
    for row in multi:
        src=Path(row["destination"])
        if re.search(r"(?<![A-Z])PEE(?![A-Z])",src.stem.upper()):
            continue
        if not src.exists(): raise FileNotFoundError(src)
        destinations=file_islands(src.name)
        if not destinations: raise RuntimeError(f"No se deducen islas de {src.name}")
        digest=sha(src)
        license_= "pendiente-revision" if re.search(r"(?<![A-Z])PEE(?![A-Z])",src.stem.upper()) else row["license"]
        for island in destinations:
            dest=ROOT/island/row["year"]/row["month"]/license_/src.name
            dest=unique_target(dest,digest)
            operations.append(("copy",src,dest,digest))

    doubts=ROOT/"desorden"/"dudas"
    for src in pee:
        digest=sha(src)
        dest=unique_target(doubts/src.name,digest)
        operations.append(("move",src,dest,digest))
    for src in motos:
        if not src.exists(): raise FileNotFoundError(src)
        operations.append(("delete",src,Path(),sha(src)))

    print(f"PDFs PEE identificados: {len(pee)}")
    print(f"Copias de documentos multiisla: {len([o for o in operations if o[0]=='copy'])}")
    print(f"PDFs Moto Náutica a borrar: {len(motos)}")
    print("PEE:")
    for p in pee: print(f"  {p.name}")

    # User explicitly requested these operations, so apply them now.
    for action,src,dest,digest in operations:
        if action=="copy":
            if dest.exists() and sha(dest)==digest: continue
            dest.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,dest)
        elif action=="move":
            dest.parent.mkdir(parents=True,exist_ok=True)
            if dest.exists() and sha(dest)==digest: src.unlink()
            else: shutil.move(str(src),str(dest))
        elif action=="delete":
            if src.exists(): src.unlink()

    doubts.mkdir(parents=True,exist_ok=True)
    readme=doubts/"README.md"
    readme.write_text("# PDFs PEE pendientes de clasificación\n\nSe identificaron por el código PEE del nombre. Se conservan aquí hasta confirmar si deben integrarse en PER o mantenerse como categoría independiente.\n\n"+"\n".join(f"- `{p.name}`" for p in pee)+"\n",encoding="utf-8")
    # Remove structural placeholders and every sorted folder with no PDF beneath it.
    for subtree in ROOT.iterdir():
        if subtree.is_dir(): prune_empty(subtree)
    action_file=Path("importer/out/cleanup-actions.csv")
    action_file.parent.mkdir(parents=True,exist_ok=True)
    with action_file.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.writer(f); w.writerow(["action","source","destination","sha256"])
        for action,src,dest,digest in operations: w.writerow([action,src,dest if str(dest)!="." else "",digest])
    print(f"Acciones registradas en {action_file}")

if __name__=="__main__": main()

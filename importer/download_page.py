"""Download PDF attachments linked from a CAIB exam page."""
import argparse
import hashlib
from email.message import Message
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.items = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.current = [dict(attrs).get("href", ""), []]

    def handle_data(self, data):
        if self.current is not None:
            self.current[1].append(data.strip())

    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            href, text = self.current
            self.items.append((href, " ".join(part for part in text if part)))
            self.current = None


def filename_from_response(headers, fallback):
    disposition = Message()
    disposition["content-disposition"] = headers.get("Content-Disposition", "")
    name = disposition.get_filename()
    if name:
        return Path(unquote(name.replace("\\", "/"))).name
    return fallback


def download(page_url: str, destination: Path):
    request = Request(page_url, headers={"User-Agent": "Mozilla/5.0 exam-pdf-downloader"})
    with urlopen(request, timeout=45) as response:
        html = response.read().decode("utf-8", "replace")
        page_url = response.geturl()
    parser = Links()
    parser.feed(html)
    urls = []
    for href, title in parser.items:
        # Some CAIB pages accidentally include spaces before ``archivopub.do``
        # in a relative link, producing a broken /%20archivopub.do URL.
        href = "".join(href.split()).replace("%20", "")
        absolute = urljoin(page_url, href)
        path = urlparse(absolute).path.casefold()
        if "archivopub.do" in path or path.endswith(".pdf"):
            if absolute not in urls:
                urls.append(absolute)

    destination.mkdir(parents=True, exist_ok=True)
    results = []
    failures = []
    for index, pdf_url in enumerate(urls, start=1):
        req = Request(pdf_url, headers={"User-Agent": "Mozilla/5.0 exam-pdf-downloader"})
        try:
            with urlopen(req, timeout=60) as response:
                data = response.read()
                if not data.startswith(b"%PDF-"):
                    raise ValueError("La respuesta no empieza con la firma de un PDF")
                filename = filename_from_response(response.headers, f"documento-{index:02}.pdf")
        except Exception as exc:
            failures.append((pdf_url, str(exc)))
            print(f"ERROR enlace {index}: {exc}")
            continue
        digest = hashlib.sha256(data).digest()
        if any(hashlib.sha256(existing.read_bytes()).digest() == digest for existing in destination.glob("*.pdf")):
            print(f"Omitido (ya existe, contenido idéntico): {filename}")
            continue
        if not filename.casefold().endswith(".pdf"):
            filename += ".pdf"
        target = destination / filename
        if target.exists():
            stem, suffix = target.stem, target.suffix
            n = 2
            while (destination / f"{stem}-{n}{suffix}").exists():
                n += 1
            target = destination / f"{stem}-{n}{suffix}"
        target.write_bytes(data)
        results.append(target)
        print(f"Descargado: {target.name} ({len(data):,} bytes)")
    print(f"Total: {len(results)} PDF(s) en {destination}")
    if failures:
        print(f"Fallidos: {len(failures)} enlace(s); puedes reintentar la misma página.")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="URL de la página de convocatoria")
    parser.add_argument("--out", type=Path, required=True, help="Carpeta destino")
    args = parser.parse_args()
    download(args.url, args.out)


if __name__ == "__main__":
    main()

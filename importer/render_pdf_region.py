"""Render a PDF page or a normalized rectangular crop as a PNG."""
import argparse
from pathlib import Path
import pymupdf

parser = argparse.ArgumentParser()
parser.add_argument("--pdf", required=True, type=Path)
parser.add_argument("--page", required=True, type=int, help="1-based page number")
parser.add_argument("--output", required=True, type=Path)
parser.add_argument("--crop", nargs=4, type=float, metavar=("X", "Y", "WIDTH", "HEIGHT"), help="Normalized page rectangle")
args = parser.parse_args()

with pymupdf.open(args.pdf) as document:
    if args.page < 1 or args.page > len(document):
        raise SystemExit("Page number out of range")
    page = document[args.page - 1]
    clip = None
    if args.crop:
        x, y, width, height = args.crop
        if min(x, y, width, height) < 0 or x + width > 1 or y + height > 1 or width <= 0 or height <= 0:
            raise SystemExit("Invalid crop rectangle")
        bounds = page.rect
        clip = pymupdf.Rect(bounds.x0 + x * bounds.width, bounds.y0 + y * bounds.height,
                            bounds.x0 + (x + width) * bounds.width, bounds.y0 + (y + height) * bounds.height)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    page.get_pixmap(matrix=pymupdf.Matrix(1.75, 1.75), clip=clip, alpha=False).save(args.output)

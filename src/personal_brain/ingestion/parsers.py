from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree


SUPPORTED_SUFFIXES = {".md", ".txt", ".doc", ".docx"}


def parse_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".md", ".txt"}:
        return path.read_text(encoding="utf-8")
    if suffix == ".docx":
        return _parse_docx(path)
    if suffix == ".doc":
        return _parse_doc(path)
    raise ValueError(f"Unsupported source type: {path.suffix}")


def _parse_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        document = archive.read("word/document.xml")
    root = ElementTree.fromstring(document)
    texts: list[str] = []
    for node in root.iter():
        if node.tag.endswith("}t") and node.text:
            texts.append(node.text)
        elif node.tag.endswith("}p"):
            texts.append("\n")
    return "".join(texts).strip()


def _parse_doc(path: Path) -> str:
    header = path.read_bytes()[:8]
    if not header.startswith(b"\xd0\xcf\x11\xe0"):
        raise ValueError("Unsupported .doc payload; expected legacy Word binary header")
    command = ["textutil", "-convert", "txt", "-stdout", str(path)]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0 or not completed.stdout.strip():
        message = completed.stderr.strip() or "textutil failed to parse .doc file"
        raise ValueError(message)
    return completed.stdout

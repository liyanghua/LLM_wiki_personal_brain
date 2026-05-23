#!/usr/bin/env python3
import argparse
import json
import html
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def slugify(value: str) -> str:
    return re.sub(r"(^-+|-+$)", "", re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", value.lower())) or "document"


def detect_enhancer(module_name: str) -> bool:
    try:
        __import__(module_name)
        return True
    except Exception:
        return False


def normalize_lines(text: str) -> list[str]:
    return [line.strip() for line in re.split(r"\n+", text) if line.strip()]


def collapse_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple)):
        parts = [collapse_text(item) for item in value]
        return "\n".join([part for part in parts if part]).strip()
    if isinstance(value, dict):
        parts = [collapse_text(item) for item in value.values()]
        return "\n".join([part for part in parts if part]).strip()
    return str(value).strip()


def flatten_table_like(value: Any) -> list[list[str]]:
    rows: list[list[str]] = []
    if not isinstance(value, (list, tuple)):
        return rows
    for row in value:
        if isinstance(row, (list, tuple)):
            normalized = [collapse_text(cell) for cell in row]
            if any(cell for cell in normalized):
                rows.append(normalized)
    return rows


def html_to_text(markup: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", markup, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</h[1-6]\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li\s*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def collect_business_rules(lines: list[str]) -> list[str]:
    cues = ("必须", "需要", "应当", "禁止", "建议", "优先", "标准", "规则")
    seen: list[str] = []
    for line in lines:
        if any(cue in line for cue in cues):
            if line not in seen:
                seen.append(line)
        if len(seen) >= 10:
            break
    return seen


def collect_sop_steps(lines: list[str]) -> list[str]:
    seen: list[str] = []
    for line in lines:
        if re.match(r"^\d+[.)、]\s*", line) or any(token in line for token in ("步骤", "流程", "第一步", "第二步", "先", "然后")):
            if line not in seen:
                seen.append(line)
        if len(seen) >= 10:
            break
    return seen


def collect_decision_points(lines: list[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for idx, line in enumerate(lines):
        if any(token in line for token in ("如果", "当", "是否", "判断", "条件", "达标", "异常")):
            items.append({
                "title": f"决策点 {len(items) + 1}",
                "condition": line,
                "action": lines[idx + 1] if idx + 1 < len(lines) else "需结合上下文确认后续动作",
                "evidenceBlockRefs": [],
            })
        if len(items) >= 8:
            break
    return items


def collect_entities(lines: list[str]) -> list[dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    pattern = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]{2,20}")
    stop = {"步骤", "流程", "方案", "问题", "需要", "进行", "当前", "这个", "以及", "可以", "业务", "内容", "图片"}
    for line in lines:
        for token in pattern.findall(line):
            if token in stop or token.isdigit():
                continue
            bucket = candidates.setdefault(token, {
                "name": token,
                "entityType": "business_term",
                "aliases": [],
                "evidenceBlockRefs": [],
                "confidence": 0.35,
                "_count": 0,
            })
            bucket["_count"] += 1
    ranked = sorted(candidates.values(), key=lambda item: item["_count"], reverse=True)[:12]
    results = []
    for item in ranked:
        count = item.pop("_count")
        item["confidence"] = min(0.92, 0.3 + count * 0.1)
        results.append(item)
    return results


def build_document_ir(blocks: list[dict[str, Any]], doc_id: str, source_name: str, source_path: str) -> dict[str, Any]:
    return {
        "docId": doc_id,
        "sourceName": source_name,
        "sourcePath": source_path,
        "createdAt": "",
        "blocks": blocks,
    }


def build_normalized_bundle(source_kind: str, source_path: str, analysis_markdown: str, blocks: list[dict[str, Any]], images: list[dict[str, Any]], revision_marks: list[dict[str, Any]], mindmap_nodes: list[dict[str, Any]], warnings: list[str]) -> dict[str, Any]:
    lines = normalize_lines(analysis_markdown)
    return {
        "sourceKind": source_kind,
        "sourcePath": source_path,
        "analysisMarkdown": analysis_markdown,
        "plainText": analysis_markdown,
        "headings": [block["textContent"] for block in blocks if block["blockType"] == "heading"],
        "tables": [],
        "images": images,
        "revisionMarks": revision_marks,
        "mindmapNodes": mindmap_nodes,
        "sourceAnchors": [
            {
                "anchorId": block["blockId"],
                "label": block["textContent"][:60],
                "blockId": block["blockId"],
                "page": block.get("page"),
                "nodePath": block.get("nodePath", []),
            }
            for block in blocks
        ],
        "sopSteps": collect_sop_steps(lines),
        "businessRules": collect_business_rules(lines),
        "decisionPoints": collect_decision_points(lines),
        "entityCandidates": collect_entities(lines),
        "missingFieldKeys": [],
        "mindmapSummary": [" > ".join(node.get("nodePath", [])) for node in mindmap_nodes[:10]],
        "warnings": warnings,
    }


def escape_markdown_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", "<br>").strip()


def column_name_to_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref.upper() if "A" <= ch <= "Z")
    index = 0
    for ch in letters:
        index = index * 26 + (ord(ch) - ord("A") + 1)
    return max(index - 1, 0)


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except Exception:
        return []
    strings: list[str] = []
    for si in root.findall(".//{*}si"):
        parts = [node.text or "" for node in si.findall(".//{*}t")]
        strings.append("".join(parts))
    return strings


def read_workbook_sheets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    rel_lookup: dict[str, str] = {}
    try:
        rel_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        for rel in rel_root.findall("{*}Relationship"):
            rel_id = rel.attrib.get("Id", "")
            target = rel.attrib.get("Target", "")
            if rel_id and target:
                rel_lookup[rel_id] = target
    except Exception:
        pass

    sheets: list[tuple[str, str]] = []
    root = ET.fromstring(archive.read("xl/workbook.xml"))
    for sheet in root.findall(".//{*}sheet"):
        name = sheet.attrib.get("name", "Sheet")
        rel_id = ""
        for key, value in sheet.attrib.items():
            if key.endswith("}id") or key == "r:id":
                rel_id = value
                break
        target = rel_lookup.get(rel_id, "")
        if not target:
            continue
        sheet_path = target if target.startswith("xl/") else f"xl/{target.lstrip('/')}"
        sheet_path = str(Path(sheet_path)).replace("\\", "/")
        sheets.append((name, sheet_path))
    if not sheets:
        for name in archive.namelist():
            if name.startswith("xl/worksheets/") and name.endswith(".xml"):
                sheets.append((Path(name).stem, name))
    return sheets


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//{*}t")).strip()
    value_node = cell.find("{*}v")
    formula_node = cell.find("{*}f")
    raw = (value_node.text if value_node is not None else "") or ""
    if cell_type == "s":
        try:
            return shared_strings[int(raw)].strip()
        except Exception:
            return raw.strip()
    if cell_type == "str":
        return raw.strip()
    if not raw and formula_node is not None:
        return f"={formula_node.text or ''}".strip()
    return raw.strip()


def read_sheet_rows(archive: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(archive.read(sheet_path))
    rows: list[list[str]] = []
    max_cols = 0
    for row in root.findall(".//{*}sheetData/{*}row"):
        values: list[str] = []
        for cell in row.findall("{*}c"):
            ref = cell.attrib.get("r", "")
            col_index = column_name_to_index(ref) if ref else len(values)
            while len(values) < col_index:
                values.append("")
            values.append(cell_value(cell, shared_strings))
        while values and values[-1] == "":
            values.pop()
        if values:
            max_cols = max(max_cols, len(values))
            rows.append(values)
    return [row + [""] * (max_cols - len(row)) for row in rows]


def rows_to_markdown(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(escape_markdown_cell(cell) for cell in normalized[0]) + " |"]
    lines.append("| " + " | ".join(["---"] * width) + " |")
    for row in normalized[1:]:
        lines.append("| " + " | ".join(escape_markdown_cell(cell) for cell in row) + " |")
    return "\n".join(lines)


def parse_xlsx(source_path: Path, source_kind: str) -> dict[str, Any]:
    warnings: list[str] = []
    blocks: list[dict[str, Any]] = []
    normalized_tables: list[dict[str, Any]] = []
    analysis_lines = [f"# {source_path.stem}", ""]
    shared_strings: list[str] = []
    with zipfile.ZipFile(source_path) as archive:
        shared_strings = read_shared_strings(archive)
        sheets = read_workbook_sheets(archive)
        if not sheets:
            warnings.append("未在工作簿中发现可解析的 sheet。")
        for sheet_index, (sheet_name, sheet_path) in enumerate(sheets, start=1):
            if sheet_path not in archive.namelist():
                warnings.append(f"工作表 {sheet_name} 缺少 XML 文件：{sheet_path}")
                continue
            rows = read_sheet_rows(archive, sheet_path, shared_strings)
            if not rows:
                continue
            markdown = rows_to_markdown(rows)
            analysis_lines.extend([f"## {sheet_name}", "", markdown, ""])
            block_id = f"{slugify(source_path.stem)}-sheet{sheet_index:03d}"
            headers = rows[0]
            data_rows = rows[1:]
            range_label = f"A1:{chr(ord('A') + min(max(len(headers) - 1, 0), 25))}{len(rows)}"
            blocks.append({
                "blockId": block_id,
                "blockType": "table",
                "textContent": markdown,
                "parentBlockId": None,
                "childBlockIds": [],
                "sourceRefs": [str(source_path)],
                "headingPath": [sheet_name],
                "level": None,
                "lineStart": 1,
                "lineEnd": len(rows),
                "page": None,
                "readingOrder": len(blocks),
                "blockRole": "spreadsheet_sheet",
                "ocrUsed": False,
                "sourceAnchorId": block_id,
                "assetPath": None,
                "approximateAnchor": False,
                "nodePath": [],
                "evidenceKind": "table",
            })
            normalized_tables.append({
                "tableId": block_id,
                "headingPath": [sheet_name],
                "headers": headers,
                "rows": data_rows,
                "sourceAnchorId": f"{source_path}#sheet={sheet_name}&range={range_label}",
            })
    analysis_markdown = "\n".join(analysis_lines).strip() + "\n"
    normalized = build_normalized_bundle(source_kind, str(source_path), analysis_markdown, blocks, [], [], [], warnings)
    normalized["tables"] = normalized_tables
    return {
        "backend": "spreadsheet_core",
        "status": "ready" if normalized_tables else "fallback",
        "detail": "已解析电子表格工作簿、Sheet 与表格行列结构。" if normalized_tables else "电子表格未解析出有效表格，已降级为空结构。",
        "degraded": bool(warnings) or not bool(normalized_tables),
        "analysis_markdown": analysis_markdown,
        "blocks": blocks,
        "normalized": normalized,
        "images": [],
        "warnings": warnings,
        "available_enhancers": ["xlsx-zip-xml"],
        "missing_enhancers": [] if source_kind == "xlsx" else ["soffice-spreadsheet-conversion"],
        "page_count": None,
        "ocr_used": False,
    }


def convert_spreadsheet_to_xlsx(source_path: Path, output_dir: Path) -> Path | None:
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        return None
    with tempfile.TemporaryDirectory(prefix="llmwiki-spreadsheet-") as tmp:
        tmp_path = Path(tmp)
        result = shutil.copy2(source_path, tmp_path / source_path.name)
        import subprocess
        completed = subprocess.run(
            [binary, "--headless", "--convert-to", "xlsx", "--outdir", str(output_dir), str(result)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            return None
    converted = output_dir / f"{source_path.stem}.xlsx"
    return converted if converted.exists() else None


def parse_spreadsheet(source_path: Path, output_dir: Path, source_kind: str) -> dict[str, Any]:
    if source_kind == "xlsx":
        return parse_xlsx(source_path, source_kind)
    converted = convert_spreadsheet_to_xlsx(source_path, output_dir)
    if converted:
        parsed = parse_xlsx(converted, source_kind)
        parsed["warnings"].append(f"原始 {source_kind.upper()} 已转换为 XLSX 后解析。")
        parsed["degraded"] = True
        return parsed
    content = (
        f"# {source_path.stem}\n\n"
        f"> 暂未检测到可用的 LibreOffice/soffice，无法结构化解析 {source_kind.upper()} 工作簿。"
        " 请安装转换器或另存为 XLSX 后重新导入。\n"
    )
    block_id = f"{slugify(source_path.stem)}-spreadsheet-unparsed"
    blocks = [{
        "blockId": block_id,
        "blockType": "paragraph",
        "textContent": content.strip(),
        "parentBlockId": None,
        "childBlockIds": [],
        "sourceRefs": [str(source_path)],
        "headingPath": [],
        "level": None,
        "lineStart": 1,
        "lineEnd": 1,
        "page": None,
        "readingOrder": 0,
        "blockRole": "spreadsheet_parse_warning",
        "ocrUsed": False,
        "sourceAnchorId": block_id,
        "assetPath": None,
        "approximateAnchor": False,
        "nodePath": [],
        "evidenceKind": "text",
    }]
    warnings = [f"{source_kind.upper()} 解析需要 LibreOffice/soffice 转换为 XLSX，当前环境未检测到转换器。"]
    normalized = build_normalized_bundle(source_kind, str(source_path), content, blocks, [], [], [], warnings)
    return {
        "backend": "spreadsheet_core",
        "status": "fallback",
        "detail": warnings[0],
        "degraded": True,
        "analysis_markdown": content,
        "blocks": blocks,
        "normalized": normalized,
        "images": [],
        "warnings": warnings,
        "available_enhancers": [],
        "missing_enhancers": ["soffice-spreadsheet-conversion"],
        "page_count": None,
        "ocr_used": False,
    }


def build_docx_analysis_markdown(blocks: list[dict[str, Any]], fallback_title: str) -> str:
    lines = [f"# {fallback_title}", ""]
    for block in blocks:
        if block["blockType"] == "heading":
            level = block.get("level") or 1
            lines.append(f"{'#' * max(1, min(level, 6))} {block['textContent']}")
        elif block["blockType"] == "table":
            lines.append(block["textContent"])
        elif block["blockType"] == "image":
            asset_path = block.get("assetPath") or ""
            lines.append(f"![{block['textContent']}]({asset_path})")
        else:
            lines.append(block["textContent"])
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def parse_docx(source_path: Path, output_dir: Path, multimodal_enabled: bool) -> dict[str, Any]:
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    rel_ns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
    warnings: list[str] = []
    available = ["python-docx"]
    missing: list[str] = []
    if detect_enhancer("mammoth"):
      available.append("mammoth")
    else:
      missing.append("mammoth")
    if detect_enhancer("docx2python"):
      available.append("docx2python")
    else:
      missing.append("docx2python")
    if detect_enhancer("docx_revisions"):
      available.append("docx-revisions")
    else:
      missing.append("docx-revisions")

    doc_xml = ""
    rel_xml = ""
    with zipfile.ZipFile(source_path) as archive:
        doc_xml = archive.read("word/document.xml").decode("utf-8", errors="ignore")
        try:
            rel_xml = archive.read("word/_rels/document.xml.rels").decode("utf-8", errors="ignore")
        except KeyError:
            rel_xml = ""
        media_files = [name for name in archive.namelist() if name.startswith("word/media/")]
        asset_dir = output_dir / "assets"
        asset_dir.mkdir(parents=True, exist_ok=True)
        extracted_images: list[dict[str, Any]] = []
        rel_lookup: dict[str, str] = {}
        if rel_xml:
            rel_root = ET.fromstring(rel_xml)
            for rel in rel_root.findall("Relationship", rel_ns):
                rel_lookup[rel.attrib.get("Id", "")] = rel.attrib.get("Target", "")
        root = ET.fromstring(doc_xml)
        blocks: list[dict[str, Any]] = []
        revision_marks: list[dict[str, Any]] = []
        image_index = 1
        current_heading_path: list[str] = []
        paragraph_index = 0

        for para in root.findall(".//w:body/w:p", ns):
            paragraph_index += 1
            style_name = ""
            ppr = para.find("w:pPr", ns)
            if ppr is not None:
                style = ppr.find("w:pStyle", ns)
                if style is not None:
                    style_name = style.attrib.get(f"{{{ns['w']}}}val", "")

            texts = []
            for node in para.findall(".//w:t", ns):
                if node.text:
                    texts.append(node.text)
            text = "".join(texts).strip()
            if not text and not para.findall(".//w:drawing", ns):
                continue

            block_type = "paragraph"
            level = None
            if style_name.lower().startswith("heading"):
                block_type = "heading"
                digits = re.findall(r"\d+", style_name)
                level = int(digits[0]) if digits else 1
                current_heading_path = current_heading_path[: max(level - 1, 0)] + ([text] if text else [])

            block_id = f"{slugify(source_path.stem)}-b{len(blocks) + 1:03d}"
            blocks.append({
                "blockId": block_id,
                "blockType": block_type,
                "textContent": text or "[图片段落]",
                "parentBlockId": None,
                "childBlockIds": [],
                "sourceRefs": [str(source_path)],
                "headingPath": current_heading_path[:-1] if block_type == "heading" else current_heading_path,
                "level": level,
                "lineStart": paragraph_index,
                "lineEnd": paragraph_index,
                "page": None,
                "readingOrder": len(blocks),
                "blockRole": style_name or None,
                "ocrUsed": False,
                "sourceAnchorId": block_id,
                "assetPath": None,
                "approximateAnchor": False,
                "nodePath": [],
                "evidenceKind": "text",
            })

            for ins in para.findall(".//w:ins", ns):
                rev_text = "".join(node.text or "" for node in ins.findall(".//w:t", ns)).strip()
                if rev_text:
                    revision_marks.append({
                        "markId": f"revision-{len(revision_marks) + 1}",
                        "kind": "insert",
                        "text": rev_text,
                        "sourceAnchorId": block_id,
                    })

            for drawing in para.findall(".//w:drawing", ns):
                rid = None
                for elem in drawing.iter():
                    for key, value in elem.attrib.items():
                        if key.endswith("embed"):
                            rid = value
                            break
                    if rid:
                        break
                target = rel_lookup.get(rid or "", "")
                media_path = f"word/{target}".replace("\\", "/") if target else None
                if media_path and media_path in media_files:
                    ext = Path(media_path).suffix or ".bin"
                    dest = asset_dir / f"image-{image_index}{ext}"
                    with archive.open(media_path) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    extracted_images.append({
                        "imageId": f"image-{image_index}",
                        "assetPath": str(dest),
                        "wikiAssetPath": f"wiki/media/{source_path.stem}/img-{image_index}{ext}",
                        "title": f"{source_path.stem} 图片 {image_index}",
                        "page": None,
                        "sourceAnchorId": block_id,
                        "approximateAnchor": True,
                        "caption": "",
                    })
                    blocks.append({
                        "blockId": f"{slugify(source_path.stem)}-img{image_index:03d}",
                        "blockType": "image",
                        "textContent": f"[图片证据] {source_path.stem} 图片 {image_index}",
                        "parentBlockId": block_id,
                        "childBlockIds": [],
                        "sourceRefs": [str(source_path)],
                        "headingPath": current_heading_path,
                        "lineStart": paragraph_index,
                        "lineEnd": paragraph_index,
                        "page": None,
                        "readingOrder": len(blocks),
                        "blockRole": "embedded_image",
                        "ocrUsed": False,
                        "sourceAnchorId": block_id,
                        "assetPath": f"wiki/media/{source_path.stem}/img-{image_index}{ext}",
                        "approximateAnchor": True,
                        "nodePath": [],
                        "evidenceKind": "image",
                    })
                    image_index += 1
                elif multimodal_enabled:
                    warnings.append("检测到 DOCX 图片节点，但没有找到可导出的媒体文件。")

    # Enhancement 1: Mammoth gives a more human reading order than raw XML walks.
    mammoth_markdown = ""
    mammoth_messages: list[str] = []
    if "mammoth" in available:
        try:
            import mammoth
            with open(source_path, "rb") as handle:
                mammoth_result = mammoth.convert_to_markdown(handle)
            mammoth_markdown = mammoth_result.value.strip()
            mammoth_messages = [str(item) for item in getattr(mammoth_result, "messages", [])]
        except Exception as exc:
            warnings.append(f"Mammoth 增强读取失败：{exc}")

    # Enhancement 2: docx2python补齐表格/页眉页脚/脚注等证据。
    normalized_tables: list[dict[str, Any]] = []
    supplemental_sections: list[str] = []
    if "docx2python" in available:
        try:
            from docx2python import docx2python
            parsed = docx2python(source_path)
            try:
                table_index = 1
                for table_candidate in parsed.body_pars[1:] if len(parsed.body_pars) > 1 else []:
                    rows = flatten_table_like(table_candidate)
                    if not rows:
                        continue
                    headers = rows[0]
                    body_rows = rows[1:] if len(rows) > 1 else []
                    anchor_id = f"{slugify(source_path.stem)}-table{table_index:03d}"
                    normalized_tables.append({
                        "tableId": anchor_id,
                        "headingPath": current_heading_path[:],
                        "headers": headers,
                        "rows": body_rows,
                        "sourceAnchorId": anchor_id,
                    })
                    markdown_rows = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
                    markdown_rows.extend("| " + " | ".join(row + [""] * max(0, len(headers) - len(row))) + " |" for row in body_rows)
                    blocks.append({
                        "blockId": anchor_id,
                        "blockType": "table",
                        "textContent": "\n".join(markdown_rows),
                        "parentBlockId": None,
                        "childBlockIds": [],
                        "sourceRefs": [str(source_path)],
                        "headingPath": current_heading_path[:],
                        "lineStart": paragraph_index + table_index,
                        "lineEnd": paragraph_index + table_index,
                        "page": None,
                        "readingOrder": len(blocks),
                        "blockRole": "table",
                        "ocrUsed": False,
                        "sourceAnchorId": anchor_id,
                        "assetPath": None,
                        "approximateAnchor": False,
                        "nodePath": [],
                        "evidenceKind": "table",
                    })
                    table_index += 1
                header_text = collapse_text(getattr(parsed, "header", []))
                footer_text = collapse_text(getattr(parsed, "footer", []))
                footnote_text = collapse_text(getattr(parsed, "footnotes", []))
                if header_text:
                    supplemental_sections.append(f"## 页眉\n{header_text}")
                if footer_text:
                    supplemental_sections.append(f"## 页脚\n{footer_text}")
                if footnote_text:
                    supplemental_sections.append(f"## 脚注\n{footnote_text}")
            finally:
                parsed.close()
        except Exception as exc:
            warnings.append(f"docx2python 增强读取失败：{exc}")

    # Enhancement 3: docx-revisions gives a stable accepted/original diff view.
    if "docx-revisions" in available:
        try:
            from docx_revisions import RevisionDocument
            revision_doc = RevisionDocument(source_path)
            for paragraph in revision_doc.all_paragraphs:
                if not getattr(paragraph, "has_track_changes", False):
                    continue
                accepted_text = collapse_text(getattr(paragraph, "accepted_text", ""))
                original_text = collapse_text(getattr(paragraph, "original_text", ""))
                if accepted_text and accepted_text != original_text:
                    revision_marks.append({
                        "markId": f"revision-{len(revision_marks) + 1}",
                        "kind": "accepted_view",
                        "text": accepted_text,
                        "sourceAnchorId": None,
                    })
                for insertion in getattr(paragraph, "insertions", []):
                    text = collapse_text(getattr(insertion, "text", ""))
                    if text:
                        revision_marks.append({
                            "markId": f"revision-{len(revision_marks) + 1}",
                            "kind": "insert",
                            "text": text,
                            "sourceAnchorId": None,
                        })
                for deletion in getattr(paragraph, "deletions", []):
                    text = collapse_text(getattr(deletion, "text", ""))
                    if text:
                        revision_marks.append({
                            "markId": f"revision-{len(revision_marks) + 1}",
                            "kind": "delete",
                            "text": text,
                            "sourceAnchorId": None,
                        })
        except Exception as exc:
            warnings.append(f"docx-revisions 增强读取失败：{exc}")

    analysis_markdown = mammoth_markdown if mammoth_markdown else build_docx_analysis_markdown(blocks, source_path.stem)
    if extracted_images and "wiki/media/" not in analysis_markdown:
        image_lines = [f"![{item['title']}]({item.get('wikiAssetPath') or item['assetPath']})" for item in extracted_images]
        analysis_markdown = analysis_markdown.rstrip() + "\n\n## 图片证据\n\n" + "\n".join(image_lines) + "\n"
    if supplemental_sections:
        analysis_markdown = analysis_markdown.rstrip() + "\n\n" + "\n\n".join(supplemental_sections) + "\n"
    if mammoth_messages:
        warnings.extend([f"Mammoth 提示：{message}" for message in mammoth_messages])

    normalized = build_normalized_bundle("docx", str(source_path), analysis_markdown, blocks, extracted_images, revision_marks, [], warnings)
    normalized["tables"] = normalized_tables
    normalized["images"] = [
        {
            "imageId": item["imageId"],
            "assetPath": item.get("wikiAssetPath") or item["assetPath"],
            "title": item.get("title"),
            "page": item.get("page"),
            "sourceAnchorId": item.get("sourceAnchorId"),
            "approximateAnchor": item.get("approximateAnchor"),
            "caption": item.get("caption", ""),
        }
        for item in extracted_images
    ]
    return {
        "backend": "docx_enhanced" if len(available) > 1 else "docx_core",
        "status": "ready",
        "detail": "已解析 DOCX 主结构，并融合阅读顺序、表格补证、图片证据与修订痕迹。" if len(available) > 1 else ("已解析 DOCX 结构、段落、图片与修订痕迹。" if extracted_images or revision_marks else "已解析 DOCX 结构与文本主链。"),
        "degraded": len(missing) > 0,
        "analysis_markdown": analysis_markdown,
        "blocks": blocks,
        "normalized": normalized,
        "images": extracted_images,
        "warnings": warnings,
        "available_enhancers": available,
        "missing_enhancers": missing,
        "page_count": None,
        "ocr_used": False,
    }


def parse_xmind(source_path: Path, output_dir: Path) -> dict[str, Any]:
    warnings: list[str] = []
    available = ["xmindparser"] if detect_enhancer("xmindparser") else []
    missing = [] if available else ["xmindparser"]
    sheets: list[dict[str, Any]] = []
    try:
        with zipfile.ZipFile(source_path) as archive:
            content = archive.read("content.json").decode("utf-8", errors="ignore")
            parsed = json.loads(content)
            if isinstance(parsed, list):
                sheets = parsed
    except Exception as exc:
        warnings.append(f"XMIND 解析退化：{exc}")

    nodes: list[dict[str, Any]] = []
    blocks: list[dict[str, Any]] = []

    def walk_topic(topic: dict[str, Any], path: list[str], parent_block_id: str | None = None) -> None:
        title = str(topic.get("title") or "").strip() or "未命名节点"
        node_path = path + [title]
        node_id = str(topic.get("id") or f"node-{len(nodes) + 1}")
        notes = ""
        notes_obj = topic.get("notes")
        if isinstance(notes_obj, dict):
            plain = notes_obj.get("plain")
            if isinstance(plain, dict):
                content = plain.get("content")
                if isinstance(content, str):
                    notes = content.strip()
        labels = [str(item) for item in topic.get("labels", []) if isinstance(item, str)]
        markers = []
        for marker in topic.get("markers", []) if isinstance(topic.get("markers"), list) else []:
            marker_id = marker.get("markerId") if isinstance(marker, dict) else None
            if isinstance(marker_id, str):
                markers.append(marker_id)
        attachments = []
        for href in topic.get("href", []) if isinstance(topic.get("href"), list) else []:
            if isinstance(href, str):
                attachments.append(href)
        child_nodes = []
        node = {
            "nodeId": node_id,
            "title": title,
            "nodePath": node_path,
            "notes": notes,
            "labels": labels,
            "markers": markers,
            "attachmentRefs": attachments,
            "imageRefs": [],
            "relationshipRefs": [],
            "childNodeIds": child_nodes,
        }
        nodes.append(node)
        block_id = f"{slugify(source_path.stem)}-mm{len(blocks) + 1:03d}"
        blocks.append({
            "blockId": block_id,
            "blockType": "mindmap_node",
            "textContent": " > ".join(node_path) + (f"\n{notes}" if notes else ""),
            "parentBlockId": parent_block_id,
            "childBlockIds": [],
            "sourceRefs": [str(source_path)],
            "headingPath": path,
            "lineStart": len(blocks) + 1,
            "lineEnd": len(blocks) + 1,
            "page": None,
            "readingOrder": len(blocks),
            "blockRole": "mindmap_topic",
            "ocrUsed": False,
            "sourceAnchorId": node_id,
            "assetPath": None,
            "approximateAnchor": False,
            "nodePath": node_path,
            "evidenceKind": "mindmap",
        })
        children = []
        if isinstance(topic.get("children"), dict):
            for key in ("attached", "detached"):
                branch = topic["children"].get(key)
                if isinstance(branch, list):
                    children.extend(branch)
        for child in children:
            if isinstance(child, dict):
                child_id = str(child.get("id") or f"node-{len(nodes) + 1}")
                child_nodes.append(child_id)
                walk_topic(child, node_path, block_id)

    for sheet in sheets:
        root = sheet.get("rootTopic") if isinstance(sheet, dict) else None
        if isinstance(root, dict):
            walk_topic(root, [])

    analysis_lines = [f"# {source_path.stem}", ""]
    for node in nodes:
        level = max(1, min(len(node["nodePath"]), 6))
        analysis_lines.append(f"{'#' * level} {node['title']}")
        if node.get("notes"):
            analysis_lines.append(node["notes"])
        analysis_lines.append("")
    analysis_markdown = "\n".join(analysis_lines).strip() + "\n"
    normalized = build_normalized_bundle("xmind", str(source_path), analysis_markdown, blocks, [], [], nodes, warnings)
    normalized["missingFieldKeys"] = []
    return {
        "backend": "xmind_core",
        "status": "ready" if nodes else "fallback",
        "detail": "已解析 XMIND 分支、说明和脑图结构。" if nodes else "XMIND 未解析出有效节点，已降级为空结构。",
        "degraded": not bool(nodes) or bool(missing),
        "analysis_markdown": analysis_markdown,
        "blocks": blocks,
        "normalized": normalized,
        "images": [],
        "warnings": warnings,
        "available_enhancers": available,
        "missing_enhancers": missing,
        "page_count": None,
        "ocr_used": False,
    }


def parse_generic(source_path: Path, source_kind: str) -> dict[str, Any]:
    content = read_text(source_path)
    blocks: list[dict[str, Any]] = []
    lines = content.splitlines()
    heading_path: list[str] = []
    for index, raw in enumerate(lines, start=1):
        text = raw.strip()
        if not text:
            continue
        block_type = "paragraph"
        level = None
        if text.startswith("#"):
            block_type = "heading"
            level = len(text) - len(text.lstrip("#"))
            text = text[level:].strip()
            heading_path = heading_path[: max(level - 1, 0)] + [text]
        blocks.append({
            "blockId": f"{slugify(source_path.stem)}-b{len(blocks) + 1:03d}",
            "blockType": block_type,
            "textContent": text,
            "parentBlockId": None,
            "childBlockIds": [],
            "sourceRefs": [str(source_path)],
            "headingPath": heading_path[:-1] if block_type == "heading" else heading_path,
            "level": level,
            "lineStart": index,
            "lineEnd": index,
            "page": None,
            "readingOrder": len(blocks),
            "blockRole": None,
            "ocrUsed": False,
            "sourceAnchorId": None,
            "assetPath": None,
            "approximateAnchor": False,
            "nodePath": [],
            "evidenceKind": "text",
        })
    normalized = build_normalized_bundle(source_kind, str(source_path), content, blocks, [], [], [], [])
    return {
        "backend": "generic",
        "status": "fallback",
        "detail": "当前文档走通用文本链路。",
        "degraded": source_kind != "generic",
        "analysis_markdown": content,
        "blocks": blocks,
        "normalized": normalized,
        "images": [],
        "warnings": [],
        "available_enhancers": [],
        "missing_enhancers": [],
        "page_count": None,
        "ocr_used": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-path", required=True)
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-kind", required=True)
    parser.add_argument("--multimodal-enabled", action="store_true")
    parser.add_argument("--multimodal-available", action="store_true")
    args = parser.parse_args()

    source_path = Path(args.source_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    source_kind = args.source_kind

    if source_kind == "docx":
        parsed = parse_docx(source_path, output_dir, args.multimodal_enabled)
    elif source_kind == "xmind":
        parsed = parse_xmind(source_path, output_dir)
    elif source_kind in ("xlsx", "xls", "ods"):
        parsed = parse_spreadsheet(source_path, output_dir, source_kind)
    else:
        parsed = parse_generic(source_path, source_kind)

    doc_id = f"{slugify(source_path.stem)}-artifact"
    document_ir = build_document_ir(parsed["blocks"], doc_id, source_path.name, str(source_path))
    normalized = parsed["normalized"]
    analysis_markdown = parsed["analysis_markdown"]

    analysis_path = output_dir / "analysis.md"
    markdown_path = output_dir / "document.md"
    html_path = output_dir / "document.html"
    json_path = output_dir / "document.json"
    normalized_path = output_dir / "normalized.json"
    document_ir_path = output_dir / "document-ir.json"
    manifest_path = output_dir / "manifest.json"

    write_text(analysis_path, analysis_markdown)
    write_text(markdown_path, analysis_markdown)
    write_text(html_path, f"<html><body><pre>{analysis_markdown}</pre></body></html>")
    write_json(json_path, {
        "sourceKind": source_kind,
        "blocks": parsed["blocks"],
        "images": parsed["images"],
        "warnings": parsed["warnings"],
    })
    write_json(normalized_path, normalized)
    write_json(document_ir_path, document_ir)

    if args.multimodal_enabled and not args.multimodal_available:
        parsed["warnings"].append("图片理解未启用，当前结果已降级。")
        parsed["detail"] += " 图片理解未启用，当前结果已降级。"
        parsed["degraded"] = True

    manifest = {
        "docId": doc_id,
        "sourceKind": source_kind,
        "backend": parsed["backend"],
        "status": parsed["status"],
        "detail": parsed["detail"],
        "degraded": parsed["degraded"],
        "analysis_path": str(analysis_path),
        "markdown_path": str(markdown_path),
        "json_path": str(json_path),
        "html_path": str(html_path),
        "normalized_path": str(normalized_path),
        "document_ir_path": str(document_ir_path),
        "converted_source_path": None,
        "asset_dir_path": str(output_dir / "assets"),
        "page_count": parsed["page_count"],
        "ocr_used": parsed["ocr_used"],
        "available_enhancers": parsed["available_enhancers"],
        "missing_enhancers": parsed["missing_enhancers"],
        "warnings": parsed["warnings"],
    }
    write_json(manifest_path, manifest)
    sys.stdout.write(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

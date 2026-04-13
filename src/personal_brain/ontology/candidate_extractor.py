from __future__ import annotations

import json
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.models import OntologyCandidate
from personal_brain.ontology.canonicalizer import Canonicalizer
from personal_brain.ontology.evidence_linker import EvidenceLinker
from personal_brain.ontology.promotion_policy import OntologyPromotionPolicy
from personal_brain.utils.frontmatter import parse_frontmatter
from personal_brain.utils.text import summarize_text


class CandidateExtractor:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.canonicalizer = Canonicalizer()
        self.evidence_linker = EvidenceLinker()
        self.promotion_policy = OntologyPromotionPolicy()

    def extract(self) -> list[OntologyCandidate]:
        pages = self._load_pages()
        non_source_pages = [page for page in pages if page["page_type"] != "source"]
        candidates: list[OntologyCandidate] = []

        for page in non_source_pages:
            candidate_type = page["page_type"].capitalize()
            candidate = OntologyCandidate(
                candidate_id=self.canonicalizer.candidate_id(candidate_type, page["title"]),
                candidate_type=candidate_type,
                canonical_name=self.canonicalizer.canonical_name(page["title"]),
                summary=page["summary"],
                wiki_refs=[page["path"]],
                source_refs=self.evidence_linker.merge(page["source_refs"]),
                attributes={"page_type": page["page_type"]},
            )
            if self.promotion_policy.allow(candidate):
                candidates.append(candidate)

        candidates.extend(self._extract_concepts(non_source_pages))
        candidates.extend(self._extract_evidence(non_source_pages))
        self._write_candidates(candidates)
        return candidates

    def _extract_concepts(self, non_source_pages: list[dict]) -> list[OntologyCandidate]:
        term_refs: dict[str, list[str]] = {}
        term_sources: dict[str, list[str]] = {}
        for page in non_source_pages:
            text = "\n".join([page["title"], page["summary"], page["body"]])
            for term in self._concept_terms(text):
                term_refs.setdefault(term, []).append(page["path"])
                term_sources.setdefault(term, []).extend(page["source_refs"])

        candidates: list[OntologyCandidate] = []
        for term, wiki_refs in term_refs.items():
            deduped_refs = self.evidence_linker.merge(wiki_refs)
            deduped_sources = self.evidence_linker.merge(term_sources.get(term, []))
            candidate = OntologyCandidate(
                candidate_id=self.canonicalizer.candidate_id("Concept", term),
                candidate_type="Concept",
                canonical_name=self.canonicalizer.canonical_name(term),
                summary=f"Cross-page concept candidate derived from {len(deduped_refs)} wiki pages.",
                wiki_refs=deduped_refs,
                source_refs=deduped_sources,
                attributes={"supporting_pages": len(deduped_refs)},
            )
            if self.promotion_policy.allow(candidate):
                candidates.append(candidate)
        return candidates

    def _extract_evidence(self, non_source_pages: list[dict]) -> list[OntologyCandidate]:
        refs: dict[str, list[str]] = {}
        for page in non_source_pages:
            for source_ref in page["source_refs"]:
                refs.setdefault(source_ref, []).append(page["path"])

        candidates: list[OntologyCandidate] = []
        for source_ref, wiki_refs in refs.items():
            source_name = Path(source_ref).stem.replace("_", " ")
            candidate = OntologyCandidate(
                candidate_id=self.canonicalizer.candidate_id("Evidence", source_name),
                candidate_type="Evidence",
                canonical_name=source_name,
                summary=f"Evidence source referenced by {len(wiki_refs)} wiki pages.",
                wiki_refs=self.evidence_linker.merge(wiki_refs),
                source_refs=[source_ref],
                attributes={"source_path": source_ref},
            )
            if self.promotion_policy.allow(candidate):
                candidates.append(candidate)
        return candidates

    def _load_pages(self) -> list[dict]:
        pages: list[dict] = []
        for path in sorted(self.paths.wiki.glob("*/*.md")):
            metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"))
            if not metadata:
                continue
            pages.append(
                {
                    "path": str(path.relative_to(self.config.root)),
                    "page_type": metadata.get("page_type", path.parent.name.rstrip("s")),
                    "title": metadata.get("title", path.stem),
                    "summary": metadata.get("summary", summarize_text(body, limit=1)),
                    "source_refs": metadata.get("source_refs", []),
                    "body": body,
                }
            )
        return pages

    def _concept_terms(self, text: str) -> list[str]:
        lowered = text.lower()
        terms: list[str] = []
        if "品牌经营os" in lowered:
            terms.append("品牌经营OS")
        if "super指标" in lowered or ("super" in lowered and "指标" in text):
            terms.append("SUPER指标")
        if "全生命周期" in text:
            terms.append("全生命周期运营")
        if "单因子测图" in text:
            terms.append("单因子测图")
        if "背景选择" in text:
            terms.append("背景选择")
        return self.evidence_linker.merge(terms)

    def _write_candidates(self, candidates: list[OntologyCandidate]) -> None:
        base = self.paths.ontology_candidates
        base.mkdir(parents=True, exist_ok=True)
        index_payload = []
        for candidate in candidates:
            folder = base / candidate.candidate_type.lower()
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{candidate.candidate_id}.json"
            path.write_text(json.dumps(candidate.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
            index_payload.append(candidate.model_dump(mode="json"))
        (base / "index.json").write_text(json.dumps(index_payload, ensure_ascii=False, indent=2), encoding="utf-8")

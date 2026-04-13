from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import AssetBuildResult
from personal_brain.ontology.candidate_extractor import CandidateExtractor
from personal_brain.skills.candidate_generator import SkillCandidateGenerator


class AssetBuildService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config

    def build(self) -> AssetBuildResult:
        ontology_candidates = CandidateExtractor(self.config).extract()
        skill_candidates = SkillCandidateGenerator(self.config).build()
        return AssetBuildResult(
            ontology_candidates=len(ontology_candidates),
            skill_candidates=len(skill_candidates),
            ontology_index_path=str((self.config.paths.ontology_candidates / "index.json").relative_to(self.config.root)),
            skills_index_path=str((self.config.paths.skills_candidates / "index.json").relative_to(self.config.root)),
        )

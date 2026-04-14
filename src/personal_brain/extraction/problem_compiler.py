from __future__ import annotations

import re

from personal_brain.config import BrainConfig
from personal_brain.models import CompiledProblem, SceneSlotDefinition, SceneSlotSchema
from personal_brain.retrieval.question_classifier import QuestionClassifier
from personal_brain.utils.files import read_json


DEFAULT_SLOT_TEMPLATES: dict[str, list[SceneSlotDefinition]] = {
    "definition": [
        SceneSlotDefinition(name="definition"),
        SceneSlotDefinition(name="scope"),
        SceneSlotDefinition(name="purpose"),
        SceneSlotDefinition(name="evidence"),
    ],
    "comparison": [
        SceneSlotDefinition(name="object_a"),
        SceneSlotDefinition(name="object_b"),
        SceneSlotDefinition(name="comparison_axes"),
        SceneSlotDefinition(name="relationship"),
        SceneSlotDefinition(name="implications"),
    ],
    "project-status": [
        SceneSlotDefinition(name="project"),
        SceneSlotDefinition(name="current_state"),
        SceneSlotDefinition(name="blockers"),
        SceneSlotDefinition(name="evidence"),
        SceneSlotDefinition(name="next_step"),
    ],
    "procedural": [
        SceneSlotDefinition(name="goal"),
        SceneSlotDefinition(name="constraints"),
        SceneSlotDefinition(name="steps"),
        SceneSlotDefinition(name="examples"),
        SceneSlotDefinition(name="success_criteria"),
    ],
    "open-ended-synthesis": [
        SceneSlotDefinition(name="object"),
        SceneSlotDefinition(name="knowledge_goal"),
        SceneSlotDefinition(name="key_claims"),
        SceneSlotDefinition(name="supporting_evidence"),
        SceneSlotDefinition(name="open_questions"),
    ],
}


class SceneLoader:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config

    def load(self, scene_id: str | None) -> SceneSlotSchema | None:
        if not scene_id:
            return None
        payload = read_json(self.config.paths.ontology_scenes / scene_id / "slots.json", default=None)
        if payload is None:
            return None
        return SceneSlotSchema.model_validate(payload)


class ProblemCompiler:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.classifier = QuestionClassifier()
        self.scene_loader = SceneLoader(config)

    def compile(
        self,
        *,
        root_question: str,
        latest_user_input: str,
        scene_id: str | None = None,
        known_slots: dict[str, str] | None = None,
        targeted_slots: list[str] | None = None,
        turn_index: int = 0,
    ) -> CompiledProblem:
        classification = self.classifier.classify(root_question)
        scene_schema = self.scene_loader.load(scene_id)

        merged_known = dict(known_slots or {})
        current_object = (
            merged_known.get("current_object")
            or merged_known.get("object")
            or (scene_schema.current_object if scene_schema is not None else None)
            or self._infer_object(root_question)
        )
        knowledge_goal = (
            merged_known.get("knowledge_goal")
            or (scene_schema.knowledge_goal if scene_schema is not None else None)
            or root_question.strip()
        )
        if current_object:
            merged_known.setdefault("current_object", current_object)
        if knowledge_goal:
            merged_known.setdefault("knowledge_goal", knowledge_goal)

        if targeted_slots and latest_user_input.strip() and latest_user_input.strip() != root_question.strip():
            for slot in targeted_slots:
                if slot not in merged_known:
                    merged_known[slot] = latest_user_input.strip()

        slot_names = self._slot_names(scene_schema, classification.question_type)
        missing_slots = [slot for slot in slot_names if not merged_known.get(slot)]
        return CompiledProblem(
            scene_id=scene_id,
            slot_schema_source="scene" if scene_schema is not None else "question_type",
            current_object=current_object or root_question.strip(),
            current_knowledge_goal=knowledge_goal or root_question.strip(),
            question_type=classification.question_type,
            known_slots=merged_known,
            missing_slots=missing_slots,
            recommended_action=self._recommended_action(missing_slots, turn_index),
            slot_names=slot_names,
            cues=classification.cues,
        )

    def _slot_names(self, scene_schema: SceneSlotSchema | None, question_type: str) -> list[str]:
        if scene_schema is not None:
            return [slot.name for slot in scene_schema.slots]
        template = DEFAULT_SLOT_TEMPLATES.get(question_type) or DEFAULT_SLOT_TEMPLATES["open-ended-synthesis"]
        return [slot.name for slot in template]

    def _infer_object(self, question: str) -> str:
        normalized = re.sub(r"[？?]", "", question).strip()
        for prefix in ["什么是", "如何", "为什么", "请解释", "解释一下", "请分析"]:
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix) :].strip()
                break
        for suffix in [
            "之间是什么关系",
            "是什么关系",
            "怎么结合",
            "有什么长期价值",
            "目前聚焦什么",
            "如何完善",
        ]:
            if normalized.endswith(suffix):
                normalized = normalized[: -len(suffix)].strip()
                break
        return normalized or question.strip()

    def _recommended_action(self, missing_slots: list[str], turn_index: int) -> str:
        if not missing_slots:
            return "write_back"
        if turn_index <= 0:
            return "retrieve_more"
        if turn_index == 1:
            return "answer"
        return "ask_follow_up"

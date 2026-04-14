from __future__ import annotations

import json

from personal_brain.config import BrainConfig
from personal_brain.extraction.problem_compiler import ProblemCompiler
from personal_brain.extraction.question_plan_builder import QuestionPlanBuilder
from personal_brain.extraction.retrieval_planner import RetrievalPlanner
from personal_brain.extraction.stopping_criteria import StoppingCriteria
from personal_brain.extraction.writeback_stager import WritebackStager
from personal_brain.models import ExtractionInterviewState, ExtractionTurn


def test_problem_compiler_prefers_scene_slots_and_falls_back_to_question_type(brain_workspace) -> None:
    scene_dir = brain_workspace / "ontology" / "scenes" / "image_planning"
    scene_dir.mkdir(parents=True, exist_ok=True)
    (scene_dir / "slots.json").write_text(
        json.dumps(
            {
                "scene_id": "image_planning",
                "current_object": "生图策划",
                "knowledge_goal": "补齐生图策划关键信息",
                "slots": [
                    {"name": "audience", "required": True},
                    {"name": "constraints", "required": True},
                    {"name": "success_criteria", "required": True},
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    compiler = ProblemCompiler(BrainConfig(root=brain_workspace))

    scene_problem = compiler.compile(
        root_question="如何完善生图策划？",
        latest_user_input="如何完善生图策划？",
        scene_id="image_planning",
    )
    fallback_problem = compiler.compile(
        root_question="什么是品牌经营OS？",
        latest_user_input="什么是品牌经营OS？",
    )

    assert scene_problem.slot_schema_source == "scene"
    assert scene_problem.current_object == "生图策划"
    assert "audience" in scene_problem.missing_slots
    assert fallback_problem.slot_schema_source == "question_type"
    assert "definition" in fallback_problem.missing_slots


def test_retrieval_planner_populates_four_buckets(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    (built_brain_workspace / "memory" / "persistent" / "principles.json").write_text(
        json.dumps(["长期经营优先于短期投机"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    compiler = ProblemCompiler(config)
    problem = compiler.compile(
        root_question="品牌经营OS和SUPER指标之间是什么关系？",
        latest_user_input="品牌经营OS和SUPER指标之间是什么关系？",
        known_slots={"current_object": "品牌经营OS", "knowledge_goal": "理解它和SUPER指标的关系"},
    )
    state = ExtractionInterviewState(
        interview_id="interview-test",
        root_question="品牌经营OS和SUPER指标之间是什么关系？",
        status="in_progress",
        current_object="品牌经营OS",
        current_knowledge_goal="理解它和SUPER指标的关系",
        known_slots={"current_object": "品牌经营OS", "knowledge_goal": "理解它和SUPER指标的关系"},
        missing_slots=problem.missing_slots,
        turns=[
            ExtractionTurn(
                turn_index=1,
                user_input="先解释下品牌经营OS",
                answer_summary="前一轮已经讨论了品牌经营OS的长期经营框架。",
                newly_filled_slots=["current_object"],
            )
        ],
    )

    retrieval = RetrievalPlanner(config).plan(problem, state)

    assert retrieval.object_pages
    assert retrieval.evidence_pages
    assert retrieval.conversation_hits
    assert retrieval.pattern_hits


def test_question_plan_targets_missing_slots_and_writeback_stager_projects_layers(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    compiler = ProblemCompiler(config)
    problem = compiler.compile(
        root_question="什么是品牌经营OS？",
        latest_user_input="什么是品牌经营OS？",
        known_slots={"current_object": "品牌经营OS", "knowledge_goal": "理解品牌经营OS的定义"},
    )

    question_plan = QuestionPlanBuilder().build(problem)

    assert question_plan.target_missing_slots
    assert question_plan.candidate_questions
    assert question_plan.next_question_type

    state = ExtractionInterviewState(
        interview_id="interview-stop",
        root_question="什么是品牌经营OS？",
        status="in_progress",
        current_object="品牌经营OS",
        current_knowledge_goal="理解品牌经营OS的定义",
        known_slots={
            "current_object": "品牌经营OS",
            "knowledge_goal": "理解品牌经营OS的定义",
            "definition": "品牌经营OS是一套围绕长期经营的协同方法。",
            "scope": "覆盖新品到成熟期。",
            "purpose": "统一人货场经营动作。",
            "evidence": "来自多份 wiki 与 raw source。",
        },
        missing_slots=[],
        ranked_pages=["wiki/topics/品牌经营os.md", "wiki/sources/电商运营本体核心文档.md"],
        retrieved_sources=["raw/industry_docs/电商运营本体核心文档.md"],
        turns=[
            ExtractionTurn(
                turn_index=1,
                user_input="什么是品牌经营OS？",
                answer_summary="已形成品牌经营OS的稳定定义。",
                newly_filled_slots=["definition", "scope", "purpose", "evidence"],
            )
        ],
        current_answer_summary="已形成品牌经营OS的稳定定义。",
    )

    stop_decision = StoppingCriteria().evaluate(state)
    staged = WritebackStager(config).stage(state, stop_decision)

    assert stop_decision.should_stop is True
    assert staged.session_level is not None
    assert staged.knowledge_level is not None
    assert staged.asset_level is not None
    assert staged.projected_writeback_level in {"knowledge-level", "asset-level"}

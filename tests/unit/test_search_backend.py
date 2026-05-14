from __future__ import annotations

import json
import subprocess
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.extraction.retrieval_planner import RetrievalPlanner
from personal_brain.models import CompiledProblem, ExtractionInterviewState, SearchHit
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.retrieval.search_provider import (
    QmdSearchProvider,
    SearchBackendUnavailable,
    WikiPageStore,
)


def test_qmd_search_provider_normalizes_results_and_uses_chinese_embed_config(monkeypatch, built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr(provider, "ensure_ready", lambda: None)
    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/usr/local/bin/qmd")

    captured: dict[str, object] = {}

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        captured["cmd"] = cmd
        captured["env"] = env
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=0,
            stdout=json.dumps(
                [
                    {
                        "path": "qmd://wiki/topics/品牌经营os.md",
                        "title": "品牌经营OS",
                        "snippet": "围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
                        "score": 0.91,
                        "context": "topic page",
                    }
                ],
                ensure_ascii=False,
            ),
            stderr="",
        )

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    hits = provider.search("什么是品牌经营OS？", limit=3, collection="wiki", explain=True)

    assert hits == [
        SearchHit(
            title="品牌经营OS",
            path="wiki/topics/品牌经营os.md",
            snippet="围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
            score=0.91,
            source_refs=[
                "raw/industry_docs/淘天商品全生命周期智能运营AI体.md",
                "raw/industry_docs/电商运营本体核心文档.md",
            ],
            collection="wiki",
            retrieval_mode="hybrid",
            explain=["topic page"],
            page_type="topic",
        )
    ]
    assert captured["env"]["QMD_EMBED_MODEL"] == config.qmd_embed_model  # type: ignore[index]
    assert captured["env"]["QMD_LLAMA_GPU"] == config.qmd_llama_gpu  # type: ignore[index]
    assert captured["env"]["XDG_CONFIG_HOME"] == str(config.paths.search_dir)  # type: ignore[index]
    assert "--json" in captured["cmd"]  # type: ignore[operator]
    assert "-n" in captured["cmd"]  # type: ignore[operator]
    assert "-c" in captured["cmd"]  # type: ignore[operator]
    assert "--no-rerank" not in captured["cmd"]  # type: ignore[operator]
    assert "--rerank" not in captured["cmd"]  # type: ignore[operator]


def test_qmd_search_provider_disables_rerank_with_current_cli_flag(monkeypatch, built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    config.qmd_enable_rerank = False
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr(provider, "ensure_ready", lambda: None)
    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/usr/local/bin/qmd")

    captured: dict[str, object] = {}

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="[]", stderr="")

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    provider.search("品牌经营OS", limit=2, collection="wiki")

    assert "--no-rerank" in captured["cmd"]  # type: ignore[operator]
    assert "--rerank" not in captured["cmd"]  # type: ignore[operator]


def test_qmd_search_provider_uses_structured_hybrid_query_to_skip_auto_expansion(
    monkeypatch,
    built_brain_workspace,
) -> None:
    config = BrainConfig(root=built_brain_workspace)
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr(provider, "ensure_ready", lambda: None)
    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/usr/local/bin/qmd")

    captured: dict[str, object] = {}

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="[]", stderr="")

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    provider.search("6大维度首先看哪个维度", limit=2, collection="wiki")

    assert captured["cmd"][3] == "query"  # type: ignore[index]
    assert captured["cmd"][4] == "lex: 6大维度首先看哪个维度\nvec: 6大维度首先看哪个维度"  # type: ignore[index]


def test_qmd_search_provider_resolves_hits_to_workspace_relative_page_paths(
    monkeypatch,
    built_brain_workspace,
) -> None:
    workspace_root = built_brain_workspace / "pilot_workspace_main"
    (workspace_root / "wiki" / "topics").mkdir(parents=True, exist_ok=True)
    source_page = built_brain_workspace / "wiki" / "topics" / "品牌经营os.md"
    target_page = workspace_root / "wiki" / "topics" / "品牌经营os.md"
    target_page.write_text(source_page.read_text(encoding="utf-8"), encoding="utf-8")
    (workspace_root / "wiki" / "index.md").write_text("- [品牌经营OS](topics/品牌经营os.md)\n", encoding="utf-8")

    config = BrainConfig(root=built_brain_workspace, workspace_root=workspace_root)
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr(provider, "ensure_ready", lambda: None)
    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/usr/local/bin/qmd")

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=0,
            stdout=json.dumps(
                [
                    {
                        "path": "qmd://wiki/topics/品牌经营os.md",
                        "title": "品牌经营OS",
                        "snippet": "围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
                        "score": 0.91,
                    }
                ],
                ensure_ascii=False,
            ),
            stderr="",
        )

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    hits = provider.search("什么是品牌经营OS？", limit=1, collection="wiki")

    assert hits[0].path == Path("pilot_workspace_main/wiki/topics/品牌经营os.md").as_posix()


def test_qmd_search_provider_canonicalizes_raw_slug_paths_to_real_repo_files(
    monkeypatch,
    built_brain_workspace,
) -> None:
    config = BrainConfig(root=built_brain_workspace)
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr(provider, "ensure_ready", lambda: None)
    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/usr/local/bin/qmd")

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=0,
            stdout=json.dumps(
                [
                    {
                        "file": "qmd://raw/industry-docs/货品全生命周期管理-super指标模型.md",
                        "title": "货品全生命周期管理-SUPER指标模型",
                        "snippet": "SUPER指标覆盖优S、高U、新P、准E、快R五个维度。",
                        "score": 0.97,
                    },
                    {
                        "file": "qmd://raw/conversations/背景选择-访谈日志.md",
                        "title": "背景选择_访谈日志",
                        "snippet": "背景选择需要兼顾平台点击效率、主体清晰度和场景代入感。",
                        "score": 0.81,
                    },
                ],
                ensure_ascii=False,
            ),
            stderr="",
        )

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    hits = provider.search("品牌经营OS和SUPER指标之间是什么关系？", limit=5, collection="raw")

    assert [hit.path for hit in hits] == [
        "raw/industry_docs/货品全生命周期管理-SUPER指标模型.md",
        "raw/conversations/背景选择_访谈日志.md",
    ]
    assert hits[0].source_refs == ["raw/industry_docs/货品全生命周期管理-SUPER指标模型.md"]
    assert hits[1].source_refs == ["raw/conversations/背景选择_访谈日志.md"]


def test_qmd_rebuild_raises_when_collection_registration_fails(monkeypatch, built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/opt/homebrew/bin/qmd")

    calls: list[list[str]] = []

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        calls.append(cmd)
        if "collection" in cmd and "add" in cmd:
            return subprocess.CompletedProcess(args=cmd, returncode=1, stdout="", stderr="collection add failed")
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    try:
        provider.rebuild_wiki_index()
    except SearchBackendUnavailable as exc:
        assert "collection add failed" in str(exc)
    else:
        raise AssertionError("expected qmd rebuild to fail when collection registration fails")


def test_qmd_rebuild_is_idempotent_when_collection_already_exists(monkeypatch, built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/opt/homebrew/bin/qmd")

    calls: list[list[str]] = []

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        calls.append(cmd)
        if "collection" in cmd and "add" in cmd:
            return subprocess.CompletedProcess(
                args=cmd,
                returncode=1,
                stdout="",
                stderr="Collection 'wiki' already exists.\nUse a different name with --name <name>",
            )
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    result = provider.rebuild_wiki_index()

    assert result["updated"] is True
    assert any("update" in cmd for cmd in calls)
    assert any("embed" in cmd for cmd in calls)


def test_qmd_rebuild_registers_raw_collection_for_evidence_only(monkeypatch, built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    store = WikiPageStore(config)
    provider = QmdSearchProvider(config, store)

    monkeypatch.setattr("personal_brain.retrieval.search_provider.shutil.which", lambda _: "/opt/homebrew/bin/qmd")

    calls: list[list[str]] = []

    def fake_run(cmd, *, capture_output, check, text, env):  # type: ignore[no-untyped-def]
        calls.append(cmd)
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("personal_brain.retrieval.search_provider.subprocess.run", fake_run)

    provider.rebuild_wiki_index()

    assert any("collection" in cmd and "add" in cmd and "wiki" in cmd for cmd in calls)
    assert any("collection" in cmd and "add" in cmd and "raw" in cmd for cmd in calls)
    assert any("qmd://raw/industry_docs" in cmd for cmd in calls)
    assert any("qmd://raw/conversations" in cmd for cmd in calls)


def test_query_engine_falls_back_to_legacy_when_qmd_search_is_unavailable(monkeypatch, built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    config.search_backend = "qmd"

    class BrokenSearchProvider:
        backend_name = "qmd"
        retrieval_mode = "hybrid"
        default_collection = "wiki"

        def search(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise SearchBackendUnavailable("qmd unavailable")

    monkeypatch.setattr(
        "personal_brain.retrieval.query_engine.build_search_provider",
        lambda config, page_store: BrokenSearchProvider(),
    )

    result = QueryEngine(config).ask("什么是品牌经营OS？")

    assert result.retrieval_backend == "legacy"
    assert result.selected_evidence
    assert "wiki/topics/品牌经营os.md" in result.ranked_pages


def test_query_engine_keeps_repo_specific_rerank_on_top_of_qmd_hits(monkeypatch, built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    config.search_backend = "qmd"

    class FakeSearchProvider:
        backend_name = "qmd"
        retrieval_mode = "hybrid"
        default_collection = "wiki"

        def search(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return [
                SearchHit(
                    title="货品全生命周期管理-SUPER指标模型",
                    path="wiki/sources/货品全生命周期管理-super指标模型.md",
                    snippet="SUPER指标覆盖优S、高U、新P、准E、快R五个维度。",
                    score=0.99,
                    source_refs=["raw/industry_docs/货品全生命周期管理-SUPER指标模型.md"],
                    collection="wiki",
                    retrieval_mode="hybrid",
                    page_type="source",
                ),
                SearchHit(
                    title="品牌经营OS",
                    path="wiki/topics/品牌经营os.md",
                    snippet="围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
                    score=0.52,
                    source_refs=["raw/industry_docs/电商运营本体核心文档.md"],
                    collection="wiki",
                    retrieval_mode="hybrid",
                    page_type="topic",
                ),
            ]

    monkeypatch.setattr(
        "personal_brain.retrieval.query_engine.build_search_provider",
        lambda config, page_store: FakeSearchProvider(),
    )

    result = QueryEngine(config).ask("什么是品牌经营OS？")

    assert result.retrieval_backend == "qmd"
    assert result.ranked_pages[0] == "wiki/topics/品牌经营os.md"


def test_query_engine_appends_raw_evidence_without_polluting_wiki_rankings(
    monkeypatch,
    built_brain_workspace,
) -> None:
    config = BrainConfig(root=built_brain_workspace)
    config.search_backend = "qmd"

    class FakeSearchProvider:
        backend_name = "qmd"
        retrieval_mode = "hybrid"
        default_collection = "wiki"

        def search(self, query, *, limit=5, collection=None, explain=False):  # type: ignore[no-untyped-def]
            active_collection = collection or self.default_collection
            if active_collection == "raw":
                return [
                    SearchHit(
                        title="背景选择_访谈日志",
                        path="raw/conversations/背景选择_访谈日志.md",
                        snippet="访谈里讨论了背景代入感、点击效率和使用场景。",
                        score=0.88,
                        source_refs=["raw/conversations/背景选择_访谈日志.md"],
                        collection="raw",
                        retrieval_mode="hybrid",
                    )
                ]
            return [
                SearchHit(
                    title="品牌经营OS",
                    path="wiki/topics/品牌经营os.md",
                    snippet="围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
                    score=0.91,
                    source_refs=["raw/industry_docs/电商运营本体核心文档.md"],
                    collection="wiki",
                    retrieval_mode="hybrid",
                    page_type="topic",
                )
            ]

    monkeypatch.setattr(
        "personal_brain.retrieval.query_engine.build_search_provider",
        lambda config, page_store: FakeSearchProvider(),
    )

    result = QueryEngine(config).ask("什么是品牌经营OS？")

    assert result.retrieval_backend == "qmd"
    assert result.ranked_pages[0] == "wiki/topics/品牌经营os.md"
    assert any(item.page_path == "raw/conversations/背景选择_访谈日志.md" for item in result.selected_evidence)
    assert "raw/conversations/背景选择_访谈日志.md" in result.retrieved_sources


def test_extraction_retrieval_planner_uses_qmd_backed_hits_without_breaking_buckets(
    monkeypatch,
    built_brain_workspace,
) -> None:
    config = BrainConfig(root=built_brain_workspace)
    config.search_backend = "qmd"

    class FakeSearchProvider:
        backend_name = "qmd"
        retrieval_mode = "hybrid"
        default_collection = "wiki"

        def search(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return [
                SearchHit(
                    title="品牌经营OS",
                    path="wiki/topics/品牌经营os.md",
                    snippet="围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
                    score=0.87,
                    source_refs=["raw/industry_docs/电商运营本体核心文档.md"],
                    collection="wiki",
                    retrieval_mode="hybrid",
                    page_type="topic",
                ),
                SearchHit(
                    title="商品全生命周期运营原则",
                    path="wiki/principles/商品全生命周期运营原则.md",
                    snippet="用生命周期视角统筹新品、成熟品和尾货。",
                    score=0.71,
                    source_refs=["raw/industry_docs/淘天商品全生命周期智能运营AI体.md"],
                    collection="wiki",
                    retrieval_mode="hybrid",
                    page_type="principle",
                ),
            ]

    monkeypatch.setattr(
        "personal_brain.retrieval.query_engine.build_search_provider",
        lambda config, page_store: FakeSearchProvider(),
    )

    problem = CompiledProblem(
        slot_schema_source="question_type",
        current_object="品牌经营OS",
        current_knowledge_goal="理解它的定义与范围",
        question_type="definition",
        known_slots={"current_object": "品牌经营OS"},
        missing_slots=["definition", "scope"],
        recommended_action="retrieve_more",
    )
    state = ExtractionInterviewState(
        interview_id="qmd-interview",
        root_question="什么是品牌经营OS？",
        current_object="品牌经营OS",
        current_knowledge_goal="理解它的定义与范围",
    )

    retrieval = RetrievalPlanner(config).plan(problem, state)

    assert retrieval.object_pages
    assert retrieval.evidence_pages
    assert retrieval.object_pages[0].path == "wiki/topics/品牌经营os.md"
    assert any(item.page_path == "wiki/topics/品牌经营os.md" for item in retrieval.evidence_pages)


def test_extraction_retrieval_planner_adds_raw_evidence_without_changing_object_pages(
    monkeypatch,
    built_brain_workspace,
) -> None:
    config = BrainConfig(root=built_brain_workspace)
    config.search_backend = "qmd"

    class FakeSearchProvider:
        backend_name = "qmd"
        retrieval_mode = "hybrid"
        default_collection = "wiki"

        def search(self, query, *, limit=5, collection=None, explain=False):  # type: ignore[no-untyped-def]
            active_collection = collection or self.default_collection
            if active_collection == "raw":
                return [
                    SearchHit(
                        title="淘天商品全生命周期智能运营AI体",
                        path="raw/industry_docs/淘天商品全生命周期智能运营AI体.md",
                        snippet="原始文档详细展开了新品到成熟期的经营闭环。",
                        score=0.79,
                        source_refs=["raw/industry_docs/淘天商品全生命周期智能运营AI体.md"],
                        collection="raw",
                        retrieval_mode="hybrid",
                    )
                ]
            return [
                SearchHit(
                    title="品牌经营OS",
                    path="wiki/topics/品牌经营os.md",
                    snippet="围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
                    score=0.87,
                    source_refs=["raw/industry_docs/电商运营本体核心文档.md"],
                    collection="wiki",
                    retrieval_mode="hybrid",
                    page_type="topic",
                ),
                SearchHit(
                    title="商品全生命周期运营原则",
                    path="wiki/principles/商品全生命周期运营原则.md",
                    snippet="用生命周期视角统筹新品、成熟品和尾货。",
                    score=0.71,
                    source_refs=["raw/industry_docs/淘天商品全生命周期智能运营AI体.md"],
                    collection="wiki",
                    retrieval_mode="hybrid",
                    page_type="principle",
                ),
            ]

    monkeypatch.setattr(
        "personal_brain.retrieval.query_engine.build_search_provider",
        lambda config, page_store: FakeSearchProvider(),
    )

    problem = CompiledProblem(
        slot_schema_source="question_type",
        current_object="品牌经营OS",
        current_knowledge_goal="理解它的定义与范围",
        question_type="definition",
        known_slots={"current_object": "品牌经营OS"},
        missing_slots=["definition", "scope"],
        recommended_action="retrieve_more",
    )
    state = ExtractionInterviewState(
        interview_id="qmd-interview-raw",
        root_question="什么是品牌经营OS？",
        current_object="品牌经营OS",
        current_knowledge_goal="理解它的定义与范围",
    )

    retrieval = RetrievalPlanner(config).plan(problem, state)

    assert retrieval.object_pages[0].path == "wiki/topics/品牌经营os.md"
    assert any(item.page_path == "raw/industry_docs/淘天商品全生命周期智能运营AI体.md" for item in retrieval.evidence_pages)

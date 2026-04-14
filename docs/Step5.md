# Brain Workbench 业务化改名与真数据化实施计划

## 摘要
- 把当前工作台从“产品/技术内部术语”改成“业务分析台”语言体系，导航、页面标题、核心区块标题、按钮文案、字段标签都统一改成面向业务同学的中文表达。
- 前端运行时彻底停用 mock 数据：移除 `live -> mock fallback`、移除 store 的 mock 初始值、移除页面对 `src/mocks` 的依赖，页面只展示真实后端返回的数据、加载态、空态和错误态。
- 保持现有路由 path 和后端 `/api/*` 契约尽量稳定，优先改“显示层语言”和“数据加载方式”，不无谓改动接口名或 URL。

## 关键改动
- 业务语言体系：
  - 导航改成：`问题分析`、`知识沉淀`、`资产候选`、`分析画像`、`评估看板`、`知识地图`
  - 页面和区块标题统一改成业务表达，例如：
    - `Ask Workspace` -> `问题分析`
    - `Writeback Review` -> `知识沉淀`
    - `Asset Candidates` -> `资产候选`
    - `Profile Workspace` -> `分析画像`
    - `Eval Reports` -> `评估看板`
    - `Wiki Explorer` -> `知识地图`
    - `Fact / Synthesis / Interpretation / Recommendation / Citations` -> `已知事实 / 综合归纳 / 业务解读 / 建议动作 / 依据来源`
  - Route path 保持 `/workspace/*` 不变，内部 route name 可保留英文，避免额外破坏性变更。
- 真数据化：
  - `brain-workbench/src/shared/api/client.ts` 改成 live-only client，不再接受 fallback 回调，也不再读取 `VITE_DATA_MODE=mock`。
  - 所有 feature `api.ts` 只请求真实 `/api/*`；当接口失败时返回 error state，而不是静默回退到 mock。
  - 所有 Pinia store 从“mock 预填充”改成“empty + loading + error”三态；页面首次进入展示 skeleton/empty/error，而不是假内容。
  - `src/mocks/`、`public/mock/`、`mock-schemas/` 不再参与运行时。保留方式默认改成：
    - 运行时不 import
    - 若测试仍需样例，迁到 `brain-workbench/src/test/fixtures/`
- 页面行为调整：
  - `Ask` 页改成业务分析流程：左侧 `最近分析 / 高频主题`，中间 `问题输入 + 结论卡片`，右侧 `命中知识 / 分析方式 / 待跟进问题`，底部 `证据片段 / 沉淀预览`
  - `Writeback` 页改成真实提案审阅，继续保留 `approve` 真接口；`reject/edit` 因后端未提供真接口，默认改成“隐藏”而不是 disabled 假动作
  - `Assets` 页只展示真实 ontology/skill candidates；`promote/merge/discard` 统一改成只读提示或隐藏，避免出现“业务上看起来可点但实际上是假动作”
  - `Profile` 页聚焦真实 method profile、persistent memory、method/style suggestions
  - `Eval` 页接真实 reports 列表与 report detail，并补上“切换 report 时真实刷新详情”，去掉当前页面里的 TODO
  - `Wiki` 页保持真实 tree/list/detail，但标题和字段都改成业务化中文
- 后端配合：
  - 现有 `apps/api/server.py` 与 `src/personal_brain/api/workbench_service.py` 基本够用，优先只补前端现在确实需要但尚未串好的真实读取行为。
  - 如果前端在真数据模式下暴露出字段缺口，只补最小只读接口，不引入新数据库或新存储层。

## 数据与接口约束
- 环境变量调整：
  - `VITE_API_BASE_URL` 保留
  - `VITE_DATA_MODE` 从运行时删除；如果保留，只允许 `live`，并在 README 中说明 mock 已停用
- 前端 state 契约统一为：
  - `data`
  - `loading`
  - `error`
  - `selectedId`（如适用）
- 后端接口默认继续使用当前这些真实接口：
  - `POST /api/ask`
  - `GET /api/memory/recent`
  - `GET /api/writeback/proposals`
  - `GET /api/writeback/proposals/:query_id`
  - `POST /api/writeback/proposals/:query_id/apply`
  - `GET /api/assets/ontology-candidates`
  - `GET /api/assets/skill-candidates`
  - `GET /api/profile/method`
  - `GET /api/profile/persistent-memory`
  - `GET /api/profile/proposals`
  - `GET /api/eval/reports`
  - `GET /api/eval/reports/:run_id`
  - `GET /api/wiki/tree`
  - `GET /api/wiki/pages`
  - `GET /api/wiki/pages/:page_id`

## 测试计划
- 前端：
  - 路由 smoke test 保持通过，但断言改成新的业务中文标题
  - 页面挂载测试不再依赖 mock store 初始值，而是显式 mock fetch 或 stub API client
  - 新增 live-only client 测试：接口失败时进入 error state，不再回退 mock
  - 新增页面态测试：loading、empty、error、real data success
  - `Eval` 页新增 report 切换测试，验证真实 detail 刷新
- 后端：
  - 保留现有 `tests/unit/test_api_server.py`
  - 如前端真数据化暴露字段缺口，补只读接口测试，不引入假数据测试路径
- 集成验收：
  - 启动后端和 Vite 后，六个页面都能在无 mock 前提下展示真实仓库数据
  - Ask 页输入真实问题后，能看到真实 answer、evidence、writeback preview
  - Writeback/Assets/Profile/Eval/Wiki 页在无 mock 回退条件下可浏览真实文件资产
  - 当后端不可用时，页面出现明确错误提示，而不是显示 mock 内容

## 假设与默认
- 业务语言风格采用“全中文业务分析台”，但内部代码命名、route path、实体类型名继续保留英文。
- 对于后端尚未提供真实动作的能力，默认选择“隐藏或只读提示”，不再保留伪交互按钮。
- `src/mocks/` 不再作为产品能力存在；如果要保留，只作为测试 fixture 使用。
- 本轮不改整体信息架构，不新加页面，只做“语言体系重构 + 真数据运行时切换 + 必要真实接口补齐”。

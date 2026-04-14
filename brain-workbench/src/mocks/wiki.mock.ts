export const wikiPagesMock = {
  pages: [
    {
      page_id: "topic_brand_operating_os",
      page_type: "topic",
      title: "品牌经营OS",
      path: "wiki/topics/品牌经营os.md",
      summary: "围绕品牌增长、货品经营和决策编译的经营框架。",
      source_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
      links_to: [
        "wiki/principles/商品全生命周期运营原则.md",
        "wiki/decisions/品牌经营os和super指标之间是什么关系-qa-note.md",
      ],
      backlinks: ["wiki/projects/儿童学习桌垫单因子测图.md"],
      updated_at: "2026-04-14T09:00:00Z",
    },
    {
      page_id: "principle_super_operating",
      page_type: "principle",
      title: "商品全生命周期运营原则",
      path: "wiki/principles/商品全生命周期运营原则.md",
      summary: "围绕货品全生命周期经营的诊断原则。",
      source_refs: ["raw/industry_docs/货品全生命周期管理-SUPER指标模型.md"],
      links_to: ["wiki/topics/品牌经营os.md"],
      backlinks: ["wiki/topics/品牌经营os.md"],
      updated_at: "2026-04-14T09:02:00Z",
    },
  ],
};

export const wikiTreeMock = {
  tree: [
    {
      page_type: "topic",
      count: 1,
      pages: [{ page_id: "topic_brand_operating_os", title: "品牌经营OS", path: "wiki/topics/品牌经营os.md" }],
    },
    {
      page_type: "principle",
      count: 1,
      pages: [{ page_id: "principle_super_operating", title: "商品全生命周期运营原则", path: "wiki/principles/商品全生命周期运营原则.md" }],
    },
  ],
};

export const wikiDetailMock = {
  page: {
    ...wikiPagesMock.pages[0],
    linked_pages: [
      { path: "wiki/principles/商品全生命周期运营原则.md", title: "商品全生命周期运营原则" },
    ],
    markdown: `# 品牌经营OS

## Summary

围绕品牌增长、货品经营和决策编译的经营框架。

## Key Points

- 强调人货场协同
- 关注全生命周期运营
- 依赖可追溯的指标和决策关系`,
  },
};

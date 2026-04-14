import { queryResponseMock } from "./query.mock";

export const writebackListMock = {
  proposals: [
    {
      query_id: "20260414-ask-001",
      question: "品牌经营OS和SUPER指标之间是什么关系？",
      created_at: "2026-04-14T09:10:00Z",
      targets: ["wiki/decisions/品牌经营os和super指标之间是什么关系-qa-note.md"],
      primary_target: "wiki/decisions/品牌经营os和super指标之间是什么关系-qa-note.md",
      primary_status: "approved-for-apply",
      primary_confidence: 0.87,
    },
  ],
};

export const writebackDetailMock = {
  ...queryResponseMock.writeback_plan,
};

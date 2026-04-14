import { ENDPOINTS } from "@/shared/api/endpoints";
import { toAskResultEntity } from "@/entities/answer-record/adapters";
import { toExtractionInterviewEntity } from "@/entities/extraction-interview/adapters";
import { apiClient } from "@/shared/api/client";
import {
  askQuestion,
  continueExtractionInterview,
  finishExtractionInterview,
  getExtractionInterview,
  startExtractionInterview,
} from "./api";

vi.mock("@/shared/api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@/entities/answer-record/adapters", () => ({
  toAskResultEntity: vi.fn((payload) => payload),
}));

vi.mock("@/entities/extraction-interview/adapters", () => ({
  toExtractionInterviewEntity: vi.fn((payload) => payload),
}));

describe("query api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockResolvedValue({ ok: true } as never);
    vi.mocked(apiClient.get).mockResolvedValue({ ok: true } as never);
  });

  it("posts quick asks to /api/ask", async () => {
    await askQuestion("什么是品牌经营OS？");

    expect(apiClient.post).toHaveBeenCalledWith(ENDPOINTS.ask, { question: "什么是品牌经营OS？" });
    expect(toAskResultEntity).toHaveBeenCalled();
  });

  it("hits all extraction endpoints with the correct payloads", async () => {
    await startExtractionInterview("什么是品牌经营OS？");
    await getExtractionInterview("extract-001");
    await continueExtractionInterview("extract-001", "它是一套长期经营框架。");
    await finishExtractionInterview("extract-001");

    expect(apiClient.post).toHaveBeenNthCalledWith(1, ENDPOINTS.extractionStart, {
      question: "什么是品牌经营OS？",
    });
    expect(apiClient.get).toHaveBeenCalledWith(ENDPOINTS.extractionDetail("extract-001"));
    expect(apiClient.post).toHaveBeenNthCalledWith(2, ENDPOINTS.extractionTurn("extract-001"), {
      user_answer: "它是一套长期经营框架。",
    });
    expect(apiClient.post).toHaveBeenNthCalledWith(3, ENDPOINTS.extractionFinish("extract-001"));
    expect(toExtractionInterviewEntity).toHaveBeenCalledTimes(4);
  });
});

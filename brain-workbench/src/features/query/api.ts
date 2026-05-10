import { toAskResultEntity } from "@/entities/answer-record/adapters";
import type { CandidateAssetEntity, InterviewSessionEntity } from "@/entities/extraction-interview/types";
import { toExtractionInterviewEntity } from "@/entities/extraction-interview/adapters";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";

export async function askQuestion(question: string) {
  const payload = await apiClient.post(ENDPOINTS.ask, { question });
  return toAskResultEntity(payload);
}

export async function startExtractionInterview(
  question: string,
  session?: Partial<Pick<InterviewSessionEntity, "title" | "topic_type" | "target_object" | "goal" | "created_by">>,
) {
  const payload = await apiClient.post(ENDPOINTS.extractionStart, { question, ...(session ?? {}) });
  return toExtractionInterviewEntity(payload);
}

export async function getExtractionInterview(interviewId: string) {
  const payload = await apiClient.get(ENDPOINTS.extractionDetail(interviewId));
  return toExtractionInterviewEntity(payload);
}

export async function continueExtractionInterview(
  interviewId: string,
  payload: { turn_action: "answer" | "skip" | "summarize"; user_answer?: string },
) {
  const response = await apiClient.post(ENDPOINTS.extractionTurn(interviewId), payload);
  return toExtractionInterviewEntity(response);
}

export async function finishExtractionInterview(interviewId: string) {
  const payload = await apiClient.post(ENDPOINTS.extractionFinish(interviewId));
  return toExtractionInterviewEntity(payload);
}

export async function updateExtractionCandidateAsset(
  interviewId: string,
  assetId: string,
  update: Partial<Pick<CandidateAssetEntity, "status" | "summary" | "expert_note">>,
) {
  const payload = await apiClient.post(ENDPOINTS.extractionAsset(interviewId, assetId), update);
  return toExtractionInterviewEntity(payload);
}

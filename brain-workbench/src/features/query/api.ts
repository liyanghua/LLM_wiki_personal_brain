import { toAskResultEntity } from "@/entities/answer-record/adapters";
import { toExtractionInterviewEntity } from "@/entities/extraction-interview/adapters";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";

export async function askQuestion(question: string) {
  const payload = await apiClient.post(ENDPOINTS.ask, { question });
  return toAskResultEntity(payload);
}

export async function startExtractionInterview(question: string) {
  const payload = await apiClient.post(ENDPOINTS.extractionStart, { question });
  return toExtractionInterviewEntity(payload);
}

export async function getExtractionInterview(interviewId: string) {
  const payload = await apiClient.get(ENDPOINTS.extractionDetail(interviewId));
  return toExtractionInterviewEntity(payload);
}

export async function continueExtractionInterview(interviewId: string, userAnswer: string) {
  const payload = await apiClient.post(ENDPOINTS.extractionTurn(interviewId), {
    user_answer: userAnswer,
  });
  return toExtractionInterviewEntity(payload);
}

export async function finishExtractionInterview(interviewId: string) {
  const payload = await apiClient.post(ENDPOINTS.extractionFinish(interviewId));
  return toExtractionInterviewEntity(payload);
}

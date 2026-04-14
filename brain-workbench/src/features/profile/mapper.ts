import { toMethodProfileEntity } from "@/entities/method-profile/adapters";

export function mapMethodProfile(payload: unknown) {
  return toMethodProfileEntity(payload);
}

export interface IdentifiedRecord {
  id: string;
  title: string;
}

export type LoadStatus = "idle" | "loading" | "ready" | "error";

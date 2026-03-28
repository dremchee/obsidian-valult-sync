import type { DocumentVersionItem } from "../types";

export type HistoryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; versions: DocumentVersionItem[] };

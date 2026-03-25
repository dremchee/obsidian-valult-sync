import type { FileVersionItem } from "../types";

export type HistoryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; versions: FileVersionItem[] };

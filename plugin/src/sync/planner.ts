import type {
  FileState,
  LocalFileSnapshot,
  RenameCandidate,
  SyncState,
} from "../types";
import {
  detectRenameCandidates,
  shouldUploadLocalChange,
  shouldUploadLocalDeletion,
} from "./flow";

export type LocalSyncSkipReason =
  | "covered-by-rename"
  | "unchanged";

export type LocalSyncOperation =
  | {
    kind: "rename";
    candidate: RenameCandidate;
  }
  | {
    kind: "upload";
    localFile: LocalFileSnapshot;
    current: FileState | undefined;
  }
  | {
    kind: "delete";
    path: string;
    fileState: FileState;
  }
  | {
    kind: "skip";
    path: string;
    reason: LocalSyncSkipReason;
  };

export interface LocalSyncPlan {
  operations: LocalSyncOperation[];
}

export function buildLocalSyncPlan(
  state: SyncState,
  localFiles: Map<string, LocalFileSnapshot>,
  shouldSyncPath: (path: string) => boolean,
): LocalSyncPlan {
  const operations: LocalSyncOperation[] = [];
  const renameCandidates = detectRenameCandidates(state, localFiles);
  const renamedFromPaths = new Set(renameCandidates.map((candidate) => candidate.fromPath));
  const renamedToPaths = new Set(renameCandidates.map((candidate) => candidate.toFile.path));

  for (const candidate of renameCandidates) {
    operations.push({
      kind: "rename",
      candidate,
    });
  }

  for (const localFile of localFiles.values()) {
    if (renamedToPaths.has(localFile.path)) {
      operations.push({
        kind: "skip",
        path: localFile.path,
        reason: "covered-by-rename",
      });
      continue;
    }

    const current = state.files[localFile.path];
    if (!shouldUploadLocalChange(current, localFile)) {
      operations.push({
        kind: "skip",
        path: localFile.path,
        reason: "unchanged",
      });
      continue;
    }

    operations.push({
      kind: "upload",
      localFile,
      current,
    });
  }

  for (const [path, fileState] of Object.entries(state.files)) {
    if (renamedFromPaths.has(path)) {
      operations.push({
        kind: "skip",
        path,
        reason: "covered-by-rename",
      });
      continue;
    }

    if (!shouldUploadLocalDeletion(path, fileState, localFiles, shouldSyncPath)) {
      continue;
    }

    operations.push({
      kind: "delete",
      path,
      fileState,
    });
  }

  return {
    operations,
  };
}

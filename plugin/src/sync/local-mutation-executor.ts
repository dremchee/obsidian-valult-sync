import type { SyncApi } from "../api";
import type {
  ContentFormat,
  LocalFileSnapshot,
  SyncSettings,
  SyncState,
} from "../types";
import {
  applyDeletedFile,
  applyRenamedFile,
  applyUploadedFile,
  createDeleteRequest,
  createRenameRequest,
  createUploadRequest,
} from "./flow";
import type { LocalSyncPlan } from "./planner";

interface LocalMutationExecutorDeps {
  buildUploadPayload: (local: LocalFileSnapshot) => Promise<{
    contentBase64: string;
    payloadHash: string;
    contentFormat: ContentFormat;
  }>;
  onDeleteConflict: (api: SyncApi, state: SyncState, path: string) => Promise<void>;
  onUploadConflict: (
    api: SyncApi,
    state: SyncState,
    localFile: LocalFileSnapshot,
  ) => Promise<void>;
  retry: <T>(operation: () => Promise<T>, label: string) => Promise<T>;
}

export class LocalMutationExecutor {
  constructor(private readonly deps: LocalMutationExecutorDeps) {}

  async executeRenames(
    api: SyncApi,
    settings: Pick<SyncSettings, "vaultId" | "deviceId">,
    state: SyncState,
    plan: LocalSyncPlan,
  ): Promise<void> {
    for (const operation of plan.operations) {
      if (operation.kind !== "rename") {
        continue;
      }

      const response = await this.deps.retry(
        () => api.rename(createRenameRequest(settings, operation.candidate)),
        `rename ${operation.candidate.fromPath} -> ${operation.candidate.toFile.path}`,
      );

      if (response.ok && response.version) {
        applyRenamedFile(state, operation.candidate, response.version);
      }
    }
  }

  async executeUploads(
    api: SyncApi,
    settings: Pick<SyncSettings, "vaultId" | "deviceId">,
    state: SyncState,
    plan: LocalSyncPlan,
  ): Promise<void> {
    for (const operation of plan.operations) {
      if (operation.kind !== "upload") {
        continue;
      }

      const response = await this.deps.retry(
        async () => {
          const payload = await this.deps.buildUploadPayload(operation.localFile);
          return api.upload(createUploadRequest(
            settings,
            operation.localFile,
            operation.current,
            payload,
          ));
        },
        `upload ${operation.localFile.path}`,
      );

      if (response.ok && response.version) {
        applyUploadedFile(state, operation.localFile, response.version);
        continue;
      }

      if (response.conflict) {
        await this.deps.onUploadConflict(api, state, operation.localFile);
      }
    }
  }

  async executeDeletions(
    api: SyncApi,
    settings: Pick<SyncSettings, "vaultId" | "deviceId">,
    state: SyncState,
    plan: LocalSyncPlan,
  ): Promise<void> {
    for (const operation of plan.operations) {
      if (operation.kind !== "delete") {
        continue;
      }

      const response = await this.deps.retry(
        () => api.delete(createDeleteRequest(settings, operation.path, operation.fileState)),
        `delete ${operation.path}`,
      );

      if (response.ok && response.version) {
        applyDeletedFile(state, operation.path, response.version);
        continue;
      }

      if (response.conflict) {
        await this.deps.onDeleteConflict(api, state, operation.path);
      }
    }
  }
}

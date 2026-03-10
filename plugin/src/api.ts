import { requestUrl } from "obsidian";

import type {
  ChangesResponse,
  CreateVaultResponse,
  DeleteRequest,
  DevicesResponse,
  FileResponse,
  MutationResponse,
  UploadRequest,
  VaultsResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class SyncApi {
  constructor(
    private readonly serverUrl: string,
    private readonly authToken: string,
  ) {}

  async health(): Promise<void> {
    await this.getJson("/health");
  }

  upload(payload: UploadRequest): Promise<MutationResponse> {
    return this.sendJson("/upload", payload);
  }

  delete(payload: DeleteRequest): Promise<MutationResponse> {
    return this.sendJson("/delete", payload);
  }

  getFile(vaultId: string, path: string): Promise<FileResponse> {
    const encodedVaultId = encodeURIComponent(vaultId);
    const encodedPath = encodeURIComponent(path);
    return this.getJson(`/file?vault_id=${encodedVaultId}&path=${encodedPath}`);
  }

  getChanges(vaultId: string, since: number): Promise<ChangesResponse> {
    const encodedVaultId = encodeURIComponent(vaultId);
    return this.getJson(`/changes?vault_id=${encodedVaultId}&since=${since}`);
  }

  getDevices(vaultId: string): Promise<DevicesResponse> {
    const encodedVaultId = encodeURIComponent(vaultId);
    return this.getJson(`/devices?vault_id=${encodedVaultId}`);
  }

  getVaults(): Promise<VaultsResponse> {
    return this.getJson("/vaults");
  }

  createVault(vaultId: string): Promise<CreateVaultResponse> {
    return this.sendJson("/vaults", { vault_id: vaultId });
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await requestUrl({
      url: `${this.serverUrl}${path}`,
      method: "GET",
      headers: this.headers(),
      throw: false,
    });

    if (response.status >= 400) {
      throw apiErrorFromResponse(response.status, response.text, response.json);
    }

    return response.json as T;
  }

  private async sendJson<T>(path: string, body: unknown): Promise<T> {
    const response = await requestUrl({
      url: `${this.serverUrl}${path}`,
      method: "POST",
      body: JSON.stringify(body),
      headers: this.headers(true),
      throw: false,
    });

    if (response.status >= 400) {
      throw apiErrorFromResponse(response.status, response.text, response.json);
    }

    return response.json as T;
  }

  private headers(includeJsonContentType = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeJsonContentType) {
      headers["Content-Type"] = "application/json";
    }
    if (this.authToken.trim()) {
      headers.Authorization = `Bearer ${this.authToken.trim()}`;
    }
    return headers;
  }
}

function apiErrorFromResponse(status: number, text: string, json: unknown): ApiError {
  const body = json as { error?: string; message?: string } | null;
  return new ApiError(
    body?.message || text || `Request failed with status ${status}`,
    status,
    body?.error,
  );
}

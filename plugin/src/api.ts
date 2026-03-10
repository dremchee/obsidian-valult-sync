import { requestUrl } from "obsidian";

import type {
  ChangesResponse,
  DeleteRequest,
  FileResponse,
  MutationResponse,
  UploadRequest,
} from "./types";

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

  private async getJson<T>(path: string): Promise<T> {
    const response = await requestUrl({
      url: `${this.serverUrl}${path}`,
      method: "GET",
      headers: this.headers(),
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(`Request failed with status ${response.status}: ${response.text}`);
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
      throw new Error(`Request failed with status ${response.status}: ${response.text}`);
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

import { requestUrl } from "obsidian";

import type {
  ChangesResponse,
  DeleteRequest,
  FileResponse,
  MutationResponse,
  UploadRequest,
} from "./types";

export class SyncApi {
  constructor(private readonly serverUrl: string) {}

  async health(): Promise<void> {
    await this.getJson("/health");
  }

  upload(payload: UploadRequest): Promise<MutationResponse> {
    return this.sendJson("/upload", payload);
  }

  delete(payload: DeleteRequest): Promise<MutationResponse> {
    return this.sendJson("/delete", payload);
  }

  getFile(path: string): Promise<FileResponse> {
    const encoded = encodeURIComponent(path);
    return this.getJson(`/file?path=${encoded}`);
  }

  getChanges(since: number): Promise<ChangesResponse> {
    return this.getJson(`/changes?since=${since}`);
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await requestUrl({
      url: `${this.serverUrl}${path}`,
      method: "GET",
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
      headers: {
        "Content-Type": "application/json",
      },
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(`Request failed with status ${response.status}: ${response.text}`);
    }

    return response.json as T;
  }
}

import { TFile, normalizePath, type App } from "obsidian";

import type { LocalFileSnapshot } from "../types";
import { toArrayBuffer, sha256Hex } from "./payload-codec";

export class ObsidianVaultIO {
  constructor(private readonly app: App) {}

  async scanVaultFiles(shouldSyncPath: (path: string) => boolean): Promise<Map<string, LocalFileSnapshot>> {
    const files = new Map<string, LocalFileSnapshot>();

    for (const file of this.app.vault.getFiles()) {
      if (!shouldSyncPath(file.path)) {
        continue;
      }

      const data = await this.readBinary(file);
      const stat = await this.app.vault.adapter.stat(file.path);
      const mtime = stat?.mtime ?? Date.now();

      files.set(file.path, {
        path: file.path,
        hash: await sha256Hex(data),
        mtime,
        data,
      });
    }

    return files;
  }

  getAbstractFileByPath(path: string): TFile | { path: string } | null {
    return this.app.vault.getAbstractFileByPath(path);
  }

  async readBinary(file: TFile): Promise<Uint8Array> {
    const arrayBuffer = await this.app.vault.readBinary(file);
    return new Uint8Array(arrayBuffer);
  }

  async writeBinary(file: TFile, data: Uint8Array): Promise<void> {
    await this.app.vault.modifyBinary(file, toArrayBuffer(data));
  }

  async createBinary(path: string, data: Uint8Array): Promise<void> {
    await this.app.vault.createBinary(path, toArrayBuffer(data));
  }

  async trashFile(file: TFile): Promise<void> {
    await this.app.fileManager.trashFile(file);
  }

  async ensureParentFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parts = normalized.split("/");
    parts.pop();

    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!current || this.app.vault.getAbstractFileByPath(current)) {
        continue;
      }
      await this.app.vault.createFolder(current);
    }
  }

  async getMtime(path: string): Promise<number> {
    const stat = await this.app.vault.adapter.stat(path);
    return stat?.mtime ?? Date.now();
  }
}

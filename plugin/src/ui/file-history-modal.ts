import { Modal } from "obsidian";

import type { FileVersionItem } from "../types";
import type { HistoryState } from "./file-history-types";
import FileHistoryModalView from "./components/FileHistoryModal.svelte";
import { destroyComponent, mountComponent, type MountedSvelteComponent } from "./svelte";

export class FileHistoryModal extends Modal {
  private component: MountedSvelteComponent | null = null;
  private state: HistoryState = { kind: "loading" };
  private restoringVersion: number | null = null;

  constructor(
    app: Modal["app"],
    private readonly path: string,
    private readonly currentVersion: number,
    private readonly loadHistory: () => Promise<FileVersionItem[]>,
    private readonly restoreVersion: (targetVersion: number) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("obsidian-sync-file-history-modal");
    this.titleEl.setText(`Server history: ${this.path}`);
    this.contentEl.empty();
    this.renderView();
    void this.render();
  }

  private async render(): Promise<void> {
    this.state = { kind: "loading" };
    this.renderView();

    try {
      const versions = await this.loadHistory();
      this.state = { kind: "loaded", versions };
    } catch (error) {
      this.state = {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.renderView();
  }

  async onClose(): Promise<void> {
    await destroyComponent(this.component);
    this.component = null;
    this.contentEl.empty();
  }

  private renderView(): void {
    void destroyComponent(this.component);
    this.component = mountComponent(FileHistoryModalView, this.contentEl, {
      currentVersion: this.currentVersion,
      state: this.state,
      restoringVersion: this.restoringVersion,
      onRestore: async (targetVersion: number) => {
        this.restoringVersion = targetVersion;
        this.renderView();
        try {
          await this.restoreVersion(targetVersion);
          this.close();
        } finally {
          this.restoringVersion = null;
          this.renderView();
        }
      },
    });
  }
}

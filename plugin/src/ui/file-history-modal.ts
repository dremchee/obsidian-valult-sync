import { Modal } from "obsidian";

import { t } from "../i18n";
import type { DocumentVersionItem } from "../types";
import type { HistoryState } from "./file-history-types";
import FileHistoryModalView from "./components/FileHistoryModal.vue";
import {
  destroyComponent,
  mountReactiveComponent,
  type ReactiveMountedVueComponent,
} from "./vue";

export class FileHistoryModal extends Modal {
  private component: ReactiveMountedVueComponent<{
    currentVersion: number;
    state: HistoryState;
    restoringVersion: number | null;
    onRestore: (targetVersion: number) => Promise<void>;
  }> | null = null;

  constructor(
    app: Modal["app"],
    private readonly path: string,
    private readonly currentVersion: number,
    private readonly loadHistory: () => Promise<DocumentVersionItem[]>,
    private readonly restoreVersion: (targetVersion: number) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("obsidian-sync-file-history-modal");
    this.titleEl.setText(t("modal.fileHistory.title", {
      path: this.path,
    }));
    this.contentEl.empty();
    this.component = mountReactiveComponent(FileHistoryModalView, this.contentEl, {
      currentVersion: this.currentVersion,
      state: { kind: "loading" },
      restoringVersion: null,
      onRestore: async (targetVersion: number) => {
        if (!this.component) {
          return;
        }

        this.component.props.restoringVersion = targetVersion;
        try {
          await this.restoreVersion(targetVersion);
          this.close();
        } finally {
          if (this.component) {
            this.component.props.restoringVersion = null;
          }
        }
      },
    });
    void this.render();
  }

  private async render(): Promise<void> {
    this.syncState({ kind: "loading" });

    try {
      const versions = await this.loadHistory();
      this.syncState({ kind: "loaded", versions });
    } catch (error) {
      this.syncState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onClose(): Promise<void> {
    await destroyComponent(this.component?.app ?? null);
    this.component = null;
    this.contentEl.empty();
  }

  private syncState(state: HistoryState): void {
    if (!this.component) {
      return;
    }

    this.component.props.state = state;
  }
}

import { Modal, Setting } from "obsidian";

import type { FileVersionItem } from "../types";

export class FileHistoryModal extends Modal {
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
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: "Loading server history...",
      cls: "setting-item-description",
    });

    try {
      const versions = await this.loadHistory();
      contentEl.empty();

      if (versions.length === 0) {
        contentEl.createEl("p", {
          text: "No server history is available for this file yet.",
          cls: "setting-item-description",
        });
        return;
      }

      for (const version of versions) {
        const description = buildVersionDescription(version, this.currentVersion);
        new Setting(contentEl)
          .setName(`Version ${version.version}`)
          .setDesc(description)
          .addButton((button) => {
            if (version.version === this.currentVersion) {
              button.setButtonText("Current").setDisabled(true);
              return;
            }

            button.setButtonText("Restore").onClick(async () => {
              button.setDisabled(true);
              try {
                await this.restoreVersion(version.version);
                this.close();
              } finally {
                button.setDisabled(false);
              }
            });
          });
      }
    } catch (error) {
      contentEl.empty();
      contentEl.createEl("p", {
        text: `Failed to load server history: ${error instanceof Error ? error.message : String(error)}`,
        cls: "setting-item-description",
      });
    }
  }
}

function buildVersionDescription(version: FileVersionItem, currentVersion: number): string {
  const parts = [
    version.created_at ? formatTimestamp(version.created_at) : "Unknown time",
    version.deleted ? "tombstone" : version.content_format,
  ];

  if (version.version === currentVersion) {
    parts.unshift("Current version");
  }

  return parts.join(" • ");
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

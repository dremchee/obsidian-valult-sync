import { Modal, Setting } from "obsidian";

export type CreateVaultModalResult = {
  vaultId: string;
  passphrase: string;
};

type SubmitCreateVault = (result: CreateVaultModalResult | null) => void;

export class CreateVaultModal extends Modal {
  private vaultId: string;
  private passphrase = "";
  private confirmPassphrase = "";
  private submitted = false;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: Modal["app"],
    initialVaultId: string,
    private readonly onSubmitCreateVault: SubmitCreateVault,
  ) {
    super(app);
    this.vaultId = initialVaultId;
  }

  onOpen(): void {
    this.titleEl.setText("Create vault");

    this.contentEl.createEl("p", {
      text: "Enter a vault name and an E2EE passphrase for the new vault.",
      cls: "setting-item-description",
    });

    new Setting(this.contentEl)
      .setName("Vault name")
      .setDesc("Used as the server-side vault ID for this folder.")
      .addText((text) => {
        text
          .setPlaceholder("team_notes")
          .setValue(this.vaultId)
          .onChange((value) => {
            this.vaultId = value.trim();
            this.clearError();
          });

        text.inputEl.focus();
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
      });

    new Setting(this.contentEl)
      .setName("E2EE passphrase")
      .setDesc("Required when creating a new vault.")
      .addText((text) => {
        text
          .setPlaceholder("correct horse battery staple")
          .setValue(this.passphrase)
          .onChange((value) => {
            this.passphrase = value;
            this.clearError();
          });

        text.inputEl.type = "password";
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
      });

    new Setting(this.contentEl)
      .setName("Confirm passphrase")
      .setDesc("Re-enter the passphrase to avoid creating the vault with a typo.")
      .addText((text) => {
        text
          .setPlaceholder("correct horse battery staple")
          .setValue(this.confirmPassphrase)
          .onChange((value) => {
            this.confirmPassphrase = value;
            this.clearError();
          });

        text.inputEl.type = "password";
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
      });

    this.errorEl = this.contentEl.createEl("div", {
      cls: "setting-item-description",
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Create vault").setCta().onClick(() => {
          this.submit();
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) {
      this.onSubmitCreateVault(null);
    }
  }

  private submit(): void {
    const vaultId = this.vaultId.trim();
    const passphrase = this.passphrase.trim();

    if (!vaultId) {
      this.errorEl?.setText("Enter a vault name.");
      return;
    }

    if (!passphrase) {
      this.errorEl?.setText("Enter an E2EE passphrase to create this vault.");
      return;
    }

    if (passphrase !== this.confirmPassphrase.trim()) {
      this.errorEl?.setText("Passphrases do not match.");
      return;
    }

    this.submitted = true;
    this.onSubmitCreateVault({
      vaultId,
      passphrase: this.passphrase,
    });
    this.close();
  }

  private clearError(): void {
    this.errorEl?.setText("");
  }
}

import { Modal } from "obsidian";

import CreateVaultModalView from "./components/CreateVaultModal.svelte";
import { destroyComponent, mountComponent, type MountedSvelteComponent } from "./svelte";

export type CreateVaultModalResult = {
  vaultId: string;
  passphrase: string;
};

type SubmitCreateVault = (result: CreateVaultModalResult | null) => void;

export class CreateVaultModal extends Modal {
  private submitted = false;
  private component: MountedSvelteComponent | null = null;

  constructor(
    app: Modal["app"],
    private readonly initialVaultId: string,
    private readonly onSubmitCreateVault: SubmitCreateVault,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Create vault");
    this.contentEl.empty();
    this.component = mountComponent(CreateVaultModalView, this.contentEl, {
      initialVaultId: this.initialVaultId,
      onSubmit: (result: CreateVaultModalResult) => {
        this.submitted = true;
        this.onSubmitCreateVault(result);
        this.close();
      },
      onCancel: () => {
        this.close();
      },
    });
  }

  async onClose(): Promise<void> {
    await destroyComponent(this.component);
    this.component = null;
    this.contentEl.empty();
    if (!this.submitted) {
      this.onSubmitCreateVault(null);
    }
  }
}

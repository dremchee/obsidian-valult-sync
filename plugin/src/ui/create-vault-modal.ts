import { Modal } from "obsidian";

import { t } from "../i18n";
import CreateVaultModalView from "./components/CreateVaultModal.vue";
import {
  destroyComponent,
  mountReactiveComponent,
  type ReactiveMountedVueComponent,
} from "./vue";

export type CreateVaultModalResult = {
  vaultId: string;
  passphrase: string;
  encryptionEnabled: boolean;
};

type SubmitCreateVault = (result: CreateVaultModalResult | null) => void;

export class CreateVaultModal extends Modal {
  private submitted = false;
  private component: ReactiveMountedVueComponent<{
    initialVaultId: string;
    onSubmit: (result: CreateVaultModalResult) => void;
    onCancel: () => void;
  }> | null = null;

  constructor(
    app: Modal["app"],
    private readonly initialVaultId: string,
    private readonly onSubmitCreateVault: SubmitCreateVault,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("modal.createVault.title"));
    this.contentEl.empty();
    this.component = mountReactiveComponent(CreateVaultModalView, this.contentEl, {
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
    await destroyComponent(this.component?.app ?? null);
    this.component = null;
    this.contentEl.empty();
    if (!this.submitted) {
      this.onSubmitCreateVault(null);
    }
  }
}

import { Modal } from "obsidian";

import { t } from "../i18n";
import JoinVaultModalView from "./components/JoinVaultModal.vue";
import {
  destroyComponent,
  mountReactiveComponent,
  type ReactiveMountedVueComponent,
} from "./vue";

export type JoinVaultModalResult = Record<string, never>;

type SubmitJoinVault = (result: JoinVaultModalResult) => Promise<string | null>;
type CancelJoinVault = () => void;

export class JoinVaultModal extends Modal {
  private submitted = false;
  private component: ReactiveMountedVueComponent<{
    vaultId: string;
    errorMessage: string;
    isSubmitting: boolean;
    onSubmit: (result: JoinVaultModalResult) => Promise<void>;
    onCancel: () => void;
  }> | null = null;

  constructor(
    app: Modal["app"],
    private readonly vaultId: string,
    private readonly onSubmitJoinVault: SubmitJoinVault,
    private readonly onCancelJoinVault: CancelJoinVault,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("modal.joinVault.title"));
    this.contentEl.empty();
    this.component = mountReactiveComponent(JoinVaultModalView, this.contentEl, {
      vaultId: this.vaultId,
      errorMessage: "",
      isSubmitting: false,
      onSubmit: async (result: JoinVaultModalResult) => {
        if (!this.component) {
          return;
        }

        this.component.props.errorMessage = "";
        this.component.props.isSubmitting = true;
        const errorMessage = await this.onSubmitJoinVault(result);
        if (!this.component) {
          return;
        }

        this.component.props.isSubmitting = false;
        if (errorMessage) {
          this.component.props.errorMessage = errorMessage;
          return;
        }

        this.submitted = true;
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
      this.onCancelJoinVault();
    }
  }
}

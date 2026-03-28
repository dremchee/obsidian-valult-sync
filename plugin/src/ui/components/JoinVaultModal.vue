<script setup lang="ts">
import { t } from "@/i18n";

const props = defineProps<{
  vaultId: string;
  errorMessage: string;
  isSubmitting: boolean;
  onSubmit: (result: Record<string, never>) => Promise<void>;
  onCancel: () => void;
}>();

async function submit(): Promise<void> {
  await props.onSubmit({});
}
</script>

<template>
  <div class="obsidian-sync-modal-copy">
    <p class="setting-item-description">
      {{ t("modal.joinVault.introPlain") }}
    </p>
  </div>

  <label class="obsidian-sync-form-row">
    <span class="obsidian-sync-form-label">{{ t("modal.joinVault.vaultName") }}</span>
    <span class="setting-item-description">{{ t("modal.joinVault.vaultNameDescription") }}</span>
    <input
      :value="props.vaultId"
      disabled
      readonly
      spellcheck="false"
      type="text"
    >
  </label>

  <div class="setting-item-description obsidian-sync-modal-error">
    {{ props.errorMessage }}
  </div>

  <div class="obsidian-sync-modal-actions">
    <button type="button" :disabled="props.isSubmitting" @click="props.onCancel()">{{ t("settings.common.cancel") }}</button>
    <button type="button" class="mod-cta" :disabled="props.isSubmitting" @click="submit">
      {{ t("settings.vault.joinVault.joinAction") }}
    </button>
  </div>
</template>

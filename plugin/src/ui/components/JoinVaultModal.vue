<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";

import { t } from "@/i18n";

const props = defineProps<{
  vaultId: string;
  errorMessage: string;
  isSubmitting: boolean;
  onSubmit: (result: { passphrase: string }) => Promise<void>;
  onCancel: () => void;
}>();

const passphrase = shallowRef("");
const localError = shallowRef("");
const passphraseInput = useTemplateRef<HTMLInputElement>("passphraseInput");

onMounted(() => {
  passphraseInput.value?.focus();
});

function clearError(): void {
  localError.value = "";
}

async function submit(): Promise<void> {
  const normalizedPassphrase = passphrase.value.trim();
  if (!normalizedPassphrase) {
    localError.value = t("modal.joinVault.errors.enterPassphrase");
    passphraseInput.value?.focus();
    return;
  }

  localError.value = "";
  await props.onSubmit({
    passphrase: passphrase.value,
  });
}
</script>

<template>
  <div class="obsidian-sync-modal-copy">
    <p class="setting-item-description">
      {{ t("modal.joinVault.intro") }}
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

  <label class="obsidian-sync-form-row">
    <span class="obsidian-sync-form-label">{{ t("modal.joinVault.passphrase") }}</span>
    <span class="setting-item-description">{{ t("modal.joinVault.passphraseDescription") }}</span>
    <input
      ref="passphraseInput"
      v-model="passphrase"
      autocomplete="current-password"
      autocapitalize="off"
      :placeholder="t('modal.joinVault.passphrasePlaceholder')"
      spellcheck="false"
      type="password"
      :disabled="props.isSubmitting"
      @input="clearError"
      @keydown.enter.prevent="submit"
    >
  </label>

  <div class="setting-item-description obsidian-sync-modal-error">
    {{ props.errorMessage || localError }}
  </div>

  <div class="obsidian-sync-modal-actions">
    <button type="button" :disabled="props.isSubmitting" @click="props.onCancel()">{{ t("settings.common.cancel") }}</button>
    <button type="button" class="mod-cta" :disabled="props.isSubmitting" @click="submit">
      {{ t("settings.vault.joinVault.joinAction") }}
    </button>
  </div>
</template>

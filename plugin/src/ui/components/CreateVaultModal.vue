<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";

import { t } from "@/i18n";

const props = defineProps<{
  initialVaultId: string;
  onSubmit: (result: { vaultId: string; passphrase: string; encryptionEnabled: boolean }) => void;
  onCancel: () => void;
}>();

const vaultId = shallowRef(props.initialVaultId);
const encryptionEnabled = shallowRef(false);
const passphrase = shallowRef("");
const confirmPassphrase = shallowRef("");
const error = shallowRef("");
const vaultInput = useTemplateRef<HTMLInputElement>("vaultInput");

onMounted(() => {
  vaultInput.value?.focus();
});

function clearError(): void {
  error.value = "";
}

function onEncryptionEnabledChange(): void {
  clearError();
  if (encryptionEnabled.value) {
    return;
  }

  passphrase.value = "";
  confirmPassphrase.value = "";
}

function submit(): void {
  const normalizedVaultId = vaultId.value.trim();
  const normalizedPassphrase = passphrase.value.trim();

  if (!normalizedVaultId) {
    error.value = t("modal.createVault.errors.enterVaultName");
    return;
  }

  if (encryptionEnabled.value && !normalizedPassphrase) {
    error.value = t("modal.createVault.errors.enterPassphrase");
    return;
  }

  if (encryptionEnabled.value && normalizedPassphrase !== confirmPassphrase.value.trim()) {
    error.value = t("modal.createVault.errors.passphraseMismatch");
    return;
  }

  props.onSubmit({
    vaultId: normalizedVaultId,
    passphrase: passphrase.value,
    encryptionEnabled: encryptionEnabled.value,
  });
}
</script>

<template>
  <div class="obsidian-sync-modal-copy">
    <p class="setting-item-description">
      {{ t("modal.createVault.intro") }}
    </p>
  </div>

  <label class="obsidian-sync-form-row">
    <span class="obsidian-sync-form-label">{{ t("modal.createVault.vaultName") }}</span>
    <span class="setting-item-description">{{ t("modal.createVault.vaultNameDescription") }}</span>
    <input
      ref="vaultInput"
      v-model="vaultId"
      autocomplete="off"
      autocapitalize="off"
      :placeholder="t('modal.createVault.vaultNamePlaceholder')"
      spellcheck="false"
      type="text"
      @input="clearError"
      @keydown.enter.prevent="submit"
    >
  </label>

  <label class="obsidian-sync-form-row">
    <span class="obsidian-sync-form-label">{{ t("modal.createVault.enableEncryption") }}</span>
    <span class="setting-item-description">{{ t("modal.createVault.enableEncryptionDescription") }}</span>
    <input
      v-model="encryptionEnabled"
      type="checkbox"
      @change="onEncryptionEnabledChange"
    >
  </label>

  <template v-if="encryptionEnabled">
    <label class="obsidian-sync-form-row">
      <span class="obsidian-sync-form-label">{{ t("modal.createVault.passphrase") }}</span>
      <span class="setting-item-description">{{ t("modal.createVault.passphraseDescription") }}</span>
      <input
        v-model="passphrase"
        autocomplete="new-password"
        autocapitalize="off"
        :placeholder="t('modal.createVault.passphrasePlaceholder')"
        spellcheck="false"
        type="password"
        @input="clearError"
        @keydown.enter.prevent="submit"
      >
    </label>

    <label class="obsidian-sync-form-row">
      <span class="obsidian-sync-form-label">{{ t("modal.createVault.confirmPassphrase") }}</span>
      <span class="setting-item-description">{{ t("modal.createVault.confirmPassphraseDescription") }}</span>
      <input
        v-model="confirmPassphrase"
        autocomplete="new-password"
        autocapitalize="off"
        :placeholder="t('modal.createVault.passphrasePlaceholder')"
        spellcheck="false"
        type="password"
        @input="clearError"
        @keydown.enter.prevent="submit"
      >
    </label>
  </template>

  <div class="setting-item-description obsidian-sync-modal-error">{{ error }}</div>

  <div class="obsidian-sync-modal-actions">
    <button type="button" @click="props.onCancel()">{{ t("settings.common.cancel") }}</button>
    <button type="button" class="mod-cta" @click="submit">{{ t("modal.createVault.create") }}</button>
  </div>
</template>

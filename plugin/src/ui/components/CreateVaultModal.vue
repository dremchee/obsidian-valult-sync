<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";

import { t } from "@/i18n";

const props = defineProps<{
  initialVaultId: string;
}>();

const emit = defineEmits<{
  submit: [result: { vaultId: string; passphrase: string }];
  cancel: [];
}>();

const vaultId = shallowRef(props.initialVaultId);
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

function submit(): void {
  const normalizedVaultId = vaultId.value.trim();
  const normalizedPassphrase = passphrase.value.trim();

  if (!normalizedVaultId) {
    error.value = t("modal.createVault.errors.enterVaultName");
    return;
  }

  if (!normalizedPassphrase) {
    error.value = t("modal.createVault.errors.enterPassphrase");
    return;
  }

  if (normalizedPassphrase !== confirmPassphrase.value.trim()) {
    error.value = t("modal.createVault.errors.passphraseMismatch");
    return;
  }

  emit("submit", {
    vaultId: normalizedVaultId,
    passphrase: passphrase.value,
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

  <div class="setting-item-description obsidian-sync-modal-error">{{ error }}</div>

  <div class="obsidian-sync-modal-actions">
    <button type="button" @click="emit('cancel')">{{ t("settings.common.cancel") }}</button>
    <button type="button" class="mod-cta" @click="submit">{{ t("modal.createVault.create") }}</button>
  </div>
</template>

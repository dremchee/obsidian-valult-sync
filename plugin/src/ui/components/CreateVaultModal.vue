<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";

import { t } from "@/i18n";

const props = defineProps<{
  initialVaultId: string;
  onSubmit: (result: { vaultId: string }) => void;
  onCancel: () => void;
}>();

const vaultId = shallowRef(props.initialVaultId);
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

  if (!normalizedVaultId) {
    error.value = t("modal.createVault.errors.enterVaultName");
    return;
  }

  props.onSubmit({
    vaultId: normalizedVaultId,
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

  <div class="setting-item-description obsidian-sync-modal-error">{{ error }}</div>

  <div class="obsidian-sync-modal-actions">
    <button type="button" @click="props.onCancel()">{{ t("settings.common.cancel") }}</button>
    <button type="button" class="mod-cta" @click="submit">{{ t("modal.createVault.create") }}</button>
  </div>
</template>

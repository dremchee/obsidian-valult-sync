<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";

const props = defineProps<{
  initialVaultId: string;
  onSubmit: (result: { vaultId: string; passphrase: string }) => void;
  onCancel: () => void;
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
    error.value = "Enter a vault name.";
    return;
  }

  if (!normalizedPassphrase) {
    error.value = "Enter an E2EE passphrase to create this vault.";
    return;
  }

  if (normalizedPassphrase !== confirmPassphrase.value.trim()) {
    error.value = "Passphrases do not match.";
    return;
  }

  props.onSubmit({
    vaultId: normalizedVaultId,
    passphrase: passphrase.value,
  });
}
</script>

<template>
  <div class="obsidian-sync-modal-copy">
    <p class="setting-item-description">
      Enter a vault name and an E2EE passphrase for the new vault.
    </p>
  </div>

  <label class="obsidian-sync-form-row">
    <span class="obsidian-sync-form-label">Vault name</span>
    <span class="setting-item-description">Used as the server-side vault ID for this folder.</span>
    <input
      ref="vaultInput"
      v-model="vaultId"
      autocomplete="off"
      autocapitalize="off"
      placeholder="team_notes"
      spellcheck="false"
      type="text"
      @input="clearError"
      @keydown.enter.prevent="submit"
    >
  </label>

  <label class="obsidian-sync-form-row">
    <span class="obsidian-sync-form-label">E2EE passphrase</span>
    <span class="setting-item-description">Required when creating a new vault.</span>
    <input
      v-model="passphrase"
      autocomplete="new-password"
      autocapitalize="off"
      placeholder="correct horse battery staple"
      spellcheck="false"
      type="password"
      @input="clearError"
      @keydown.enter.prevent="submit"
    >
  </label>

  <label class="obsidian-sync-form-row">
    <span class="obsidian-sync-form-label">Confirm passphrase</span>
    <span class="setting-item-description">Re-enter the passphrase to avoid creating the vault with a typo.</span>
    <input
      v-model="confirmPassphrase"
      autocomplete="new-password"
      autocapitalize="off"
      placeholder="correct horse battery staple"
      spellcheck="false"
      type="password"
      @input="clearError"
      @keydown.enter.prevent="submit"
    >
  </label>

  <div class="setting-item-description obsidian-sync-modal-error">{{ error }}</div>

  <div class="obsidian-sync-modal-actions">
    <button type="button" @click="props.onCancel">Cancel</button>
    <button type="button" class="mod-cta" @click="submit">Create vault</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import SettingsConnectionSection from "./SettingsConnectionSection.vue";
import SettingsOverviewSection from "./SettingsOverviewSection.vue";
import SettingsScopeSection from "./SettingsScopeSection.vue";
import SettingsVaultSection from "./SettingsVaultSection.vue";
import type { SettingsActions, SettingsViewModel } from "../view-model";

const props = defineProps<{
  model: SettingsViewModel;
  actions: SettingsActions;
}>();

const availableJoinVaults = computed(() =>
  (props.model.remoteVaults ?? []).filter(
    (vault) => vault.vault_id !== props.model.currentVaultId,
  ),
);

const currentVaultOnServer = computed(
  () => props.model.remoteVaults?.some((vault) => vault.vault_id === props.model.currentVaultId) ?? false,
);

const serverRegistryStatus = computed(() => {
  if (!props.model.currentVaultId) {
    return "Not connected";
  }
  if (props.model.remoteVaults) {
    return currentVaultOnServer.value ? "Loaded" : "Not loaded here";
  }
  if (props.model.loadingRemoteVaults) {
    return "Loading...";
  }
  return props.model.remoteVaultsError ? "Unavailable" : "Not loaded";
});

const vaultRegistryDescription = computed(() => {
  if (props.model.loadingRemoteVaults) {
    return "Loading vaults from the server...";
  }
  if (props.model.remoteVaultsError) {
    return `Vault list is unavailable: ${props.model.remoteVaultsError}`;
  }
  if (props.model.remoteVaults) {
    if (props.model.remoteVaults.length === 0) {
      return "No vaults exist on the server yet.";
    }
    if (props.model.currentVaultId && !currentVaultOnServer.value) {
      return `Loaded ${props.model.remoteVaults.length} vault(s). The current vault is not in the server registry.`;
    }
    return `Loaded ${props.model.remoteVaults.length} vault(s) from the server.`;
  }
  return "Load vaults from the server to join an existing one.";
});
</script>

<template>
  <SettingsConnectionSection :actions="props.actions" :model="props.model" />

  <template v-if="props.model.unlocked">
    <SettingsOverviewSection :actions="props.actions" :model="props.model" />
    <SettingsVaultSection
      :actions="props.actions"
      :available-join-vaults="availableJoinVaults"
      :current-vault-on-server="currentVaultOnServer"
      :model="props.model"
      :server-registry-status="serverRegistryStatus"
      :vault-registry-description="vaultRegistryDescription"
    />
    <SettingsScopeSection :actions="props.actions" :model="props.model" />
  </template>
</template>

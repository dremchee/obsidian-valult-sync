<script setup lang="ts">
import { shallowRef, watch } from "vue";

import type { VaultItem } from "../../types";
import type { SettingsActions, SettingsViewModel } from "../view-model";

const props = defineProps<{
  model: SettingsViewModel;
  actions: SettingsActions;
  availableJoinVaults: VaultItem[];
  currentVaultOnServer: boolean;
  serverRegistryStatus: string;
  vaultRegistryDescription: string;
}>();

const remoteJoinVaultId = shallowRef("");

watch(
  () => props.availableJoinVaults,
  (vaults) => {
    if (!vaults.some((vault) => vault.vault_id === remoteJoinVaultId.value)) {
      remoteJoinVaultId.value = vaults[0]?.vault_id ?? "";
    }
  },
  { immediate: true },
);

function handleJoinVault(): void {
  if (!remoteJoinVaultId.value) {
    return;
  }

  props.actions.onJoinVault(remoteJoinVaultId.value);
}
</script>

<template>
  <div class="setting-group">
    <div class="setting-item setting-item-heading">
      <div class="setting-item-name">Vault</div>
    </div>
    <div class="setting-items">
      <div class="setting-item obsidian-sync-inline-status-row">
        <div class="setting-item-description obsidian-sync-inline-status">
          Vault registry: {{ props.model.vaultStatusText }}
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Current vault</div>
          <div class="setting-item-description">
            Connected vault: {{ props.model.currentVaultId || "Not connected" }}. Server registry:
            {{ props.serverRegistryStatus }}.
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button type="button" :disabled="!props.model.currentVaultId" @click="props.actions.onDisconnectVault">
            {{ props.model.confirmDisconnect ? "Confirm disconnect" : "Disconnect" }}
          </button>
          <button
            type="button"
            class="mod-warning"
            :disabled="!props.model.currentVaultId"
            @click="props.actions.onForgetLocalState"
          >
            {{ props.model.confirmForget ? "Confirm forget" : "Forget local state" }}
          </button>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Server vaults</div>
          <div class="setting-item-description">{{ props.vaultRegistryDescription }}</div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button type="button" :disabled="props.model.loadingRemoteVaults" @click="props.actions.onLoadVaults">
            Load vaults
          </button>
          <button
            type="button"
            class="mod-cta"
            :disabled="!props.model.currentVaultId || !props.model.remoteVaults || props.currentVaultOnServer"
            @click="props.actions.onCreateCurrentVault"
          >
            Create current
          </button>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Create vault</div>
          <div class="setting-item-description">
            {{
              props.model.currentVaultId
                ? "Create a new vault on the server and reconnect this folder to it."
                : "Create a new vault on the server and connect this folder to it."
            }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-action-control">
          <button type="button" class="mod-cta" @click="props.actions.onCreateVault">Create vault</button>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ props.model.currentVaultId ? "Reconnect this folder" : "Join server vault" }}
          </div>
          <div class="setting-item-description">
            <template v-if="props.model.remoteVaults">
              {{
                props.model.currentVaultId
                  ? "Reconnect this folder to a vault discovered on the server."
                  : "Connect this folder to a vault discovered on the server."
              }}
            </template>
            <template v-else-if="props.model.loadingRemoteVaults">Loading vaults from the server...</template>
            <template v-else>Load vaults from the server first.</template>
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-field-controls">
          <select v-model="remoteJoinVaultId">
            <option v-if="props.availableJoinVaults.length === 0" value="">
              {{ props.model.loadingRemoteVaults ? "Loading..." : "No loaded vaults" }}
            </option>
            <option
              v-for="vault in props.availableJoinVaults"
              v-else
              :key="vault.vault_id"
              :value="vault.vault_id"
            >
              {{ vault.vault_id }}
            </option>
          </select>
          <button type="button" :disabled="!remoteJoinVaultId" @click="handleJoinVault">Join</button>
        </div>
      </div>
    </div>
  </div>
</template>

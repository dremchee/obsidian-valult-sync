<script setup lang="ts">
  import { shallowRef, watch } from 'vue'

  import { t } from '@/i18n'
  import type { VaultItem } from '@/types'
  import type {
    SettingsVaultActions,
    SettingsVaultViewModel,
  } from '../view-model'

  const props = defineProps<{
    model: SettingsVaultViewModel
    actions: SettingsVaultActions
    availableJoinVaults: VaultItem[]
    serverRegistryStatus: string
  }>()

  const remoteJoinVaultId = shallowRef('')

  watch(
    () => props.availableJoinVaults,
    (vaults) => {
      if (!vaults.some((vault) => vault.vault_id === remoteJoinVaultId.value)) {
        remoteJoinVaultId.value = vaults[0]?.vault_id ?? ''
      }
    },
    { immediate: true }
  )

  function handleJoinVault(): void {
    if (!remoteJoinVaultId.value) {
      return
    }

    props.actions.onJoinVault(remoteJoinVaultId.value)
  }
</script>

<template>
  <div class="setting-group">
    <div class="setting-item setting-item-heading">
      <div class="setting-item-name">{{ t('settings.vault.heading') }}</div>
    </div>
    <div class="setting-items">
      <div class="setting-item obsidian-sync-inline-status-row">
        <div class="setting-item-description obsidian-sync-inline-status">
          {{
            t('settings.vault.registryStatus', {
              status: props.model.vaultStatusText
            })
          }}
        </div>
      </div>

      <div
        v-if="props.model.pendingJoinDecision"
        class="setting-item obsidian-sync-with-top-border"
      >
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.vault.joinDecision.label') }}
          </div>
          <div class="setting-item-description">
            {{
              t('settings.vault.joinDecision.description', {
                vaultId: props.model.pendingJoinVaultId,
                count: props.model.pendingJoinLocalFileCount
              })
            }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button
            type="button"
            class="mod-warning"
            @click="props.actions.onAdoptServerVault"
          >
            {{ t('settings.vault.joinDecision.adoptServer') }}
          </button>
          <button
            type="button"
            @click="props.actions.onSyncJoinedVault"
          >
            {{ t('settings.vault.joinDecision.syncWithConflicts') }}
          </button>
        </div>
      </div>

      <div
        v-if="props.model.currentVaultId"
        class="setting-item obsidian-sync-with-top-border"
      >
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.vault.currentVault.label') }}
          </div>
          <div class="setting-item-description">
            {{
              t('settings.vault.currentVault.description', {
                vaultId:
                  props.model.currentVaultId ||
                  t('settings.common.notConnected'),
                registryStatus: props.serverRegistryStatus
              })
            }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button
            type="button"
            :disabled="!props.model.currentVaultId"
            @click="props.actions.onDisconnectVault"
          >
            {{
              props.model.confirmDisconnect
                ? t('settings.vault.currentVault.confirmDisconnect')
                : t('settings.vault.currentVault.disconnect')
            }}
          </button>
          <button
            type="button"
            class="mod-warning"
            :disabled="!props.model.currentVaultId"
            @click="props.actions.onForgetLocalState"
          >
            {{
              props.model.confirmForget
                ? t('settings.vault.currentVault.confirmForget')
                : t('settings.vault.currentVault.forget')
            }}
          </button>
        </div>
      </div>

      <div
        v-if="!props.model.currentVaultId"
        class="setting-item obsidian-sync-with-top-border"
      >
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.vault.createVault.label') }}
          </div>
          <div class="setting-item-description">
            {{
              props.model.currentVaultId
                ? t('settings.vault.createVault.descriptionConnected')
                : t('settings.vault.createVault.descriptionDisconnected')
            }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-action-control">
          <button
            type="button"
            class="mod-cta"
            @click="props.actions.onCreateVault"
          >
            {{ t('settings.vault.createVault.action') }}
          </button>
        </div>
      </div>

      <div
        v-if="!props.model.currentVaultId && props.availableJoinVaults.length > 0"
        class="setting-item obsidian-sync-with-top-border"
      >
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.vault.joinVault.joinLabel') }}
          </div>
        </div>
        <div class="setting-item-control">
          <select v-model="remoteJoinVaultId">
            <option v-if="props.availableJoinVaults.length === 0" value="">
              {{
                props.model.loadingRemoteVaults
                  ? t('settings.common.loading')
                  : t('settings.vault.joinVault.noLoadedVaults')
              }}
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
          <button
            type="button"
            :disabled="!remoteJoinVaultId"
            @click="handleJoinVault"
          >
            {{ t('settings.vault.joinVault.joinAction') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

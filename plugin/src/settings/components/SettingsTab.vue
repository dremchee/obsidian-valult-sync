<script setup lang="ts">
  import { computed } from 'vue'

  import { t } from '@/i18n'
  import SettingsConnectionSection from './SettingsConnectionSection.vue'
  import SettingsOverviewSection from './SettingsOverviewSection.vue'
  import SettingsScopeSection from './SettingsScopeSection.vue'
  import SettingsVaultSection from './SettingsVaultSection.vue'
  import type { SettingsActions, SettingsViewModel } from '../view-model'

  const props = defineProps<{
    model: SettingsViewModel
    actions: SettingsActions
  }>()

  const availableJoinVaults = computed(() =>
    (props.model.vault.remoteVaults ?? []).filter(
      (vault) => vault.vault_id !== props.model.vault.currentVaultId
    )
  )

  const currentVaultOnServer = computed(
    () =>
      props.model.vault.remoteVaults?.some(
        (vault) => vault.vault_id === props.model.vault.currentVaultId
      ) ?? false
  )

  const serverRegistryStatus = computed(() => {
    if (!props.model.vault.currentVaultId) {
      return t('settings.vault.registryState.notConnected')
    }
    if (props.model.vault.remoteVaults) {
      return currentVaultOnServer.value
        ? t('settings.vault.registryState.loaded')
        : t('settings.vault.registryState.notLoadedHere')
    }
    if (props.model.vault.loadingRemoteVaults) {
      return t('settings.vault.registryState.loading')
    }
    return props.model.vault.remoteVaultsError
      ? t('settings.vault.registryState.unavailable')
      : t('settings.vault.registryState.notLoaded')
  })

  const vaultRegistryDescription = computed(() => {
    if (props.model.vault.loadingRemoteVaults) {
      return t('settings.vault.serverVaults.statusLoading')
    }
    if (props.model.vault.remoteVaultsError) {
      return t('settings.vault.serverVaults.unavailable', {
        message: props.model.vault.remoteVaultsError
      })
    }
    if (props.model.vault.remoteVaults) {
      if (props.model.vault.remoteVaults.length === 0) {
        return t('settings.vault.serverVaults.empty')
      }
      if (props.model.vault.currentVaultId && !currentVaultOnServer.value) {
        return t('settings.vault.serverVaults.currentNotLoaded', {
          count: props.model.vault.remoteVaults.length
        })
      }
      return t('settings.vault.serverVaults.loaded', {
        count: props.model.vault.remoteVaults.length
      })
    }
    return t('settings.vault.serverVaults.loadPrompt')
  })
</script>

<template>
  <SettingsConnectionSection :actions="props.actions" :model="props.model.connection" />

  <template v-if="props.model.connection.unlocked">
    <SettingsOverviewSection :actions="props.actions" :model="props.model.overview" />
    <SettingsVaultSection
      :actions="props.actions"
      :available-join-vaults="availableJoinVaults"
      :current-vault-on-server="currentVaultOnServer"
      :model="props.model.vault"
      :server-registry-status="serverRegistryStatus"
      :vault-registry-description="vaultRegistryDescription"
    />
    <SettingsScopeSection :actions="props.actions" :model="props.model.scope" />
  </template>
</template>

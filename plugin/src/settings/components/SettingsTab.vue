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

  const serverRegistryStatus = computed(() => {
    if (!props.model.vault.currentVaultId) {
      return t('settings.vault.registryState.notConnected')
    }
    if (props.model.vault.loadingRemoteVaults) {
      return t('settings.vault.registryState.loading')
    }
    return props.model.vault.remoteVaultsError
      ? t('settings.vault.registryState.unavailable')
      : t('settings.vault.registryState.notLoaded')
  })

</script>

<template>
  <SettingsConnectionSection :actions="props.actions" :model="props.model.connection" />

  <template v-if="props.model.connection.unlocked">
    <SettingsOverviewSection :actions="props.actions" :model="props.model.overview" />
    <SettingsVaultSection
      :actions="props.actions"
      :available-join-vaults="availableJoinVaults"
      :model="props.model.vault"
      :server-registry-status="serverRegistryStatus"
    />
    <SettingsScopeSection :actions="props.actions" :model="props.model.scope" />
  </template>
</template>

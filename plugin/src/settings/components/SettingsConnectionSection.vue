<script setup lang="ts">
  import { t } from '@/i18n'
  import type { SettingsActions, SettingsViewModel } from '../view-model'

  const props = defineProps<{
    model: SettingsViewModel
    actions: SettingsActions
  }>()

  function handleServerUrlInput(event: Event): void {
    props.actions.onServerUrlChange(
      (event.currentTarget as HTMLInputElement).value
    )
  }

  function handleAuthTokenInput(event: Event): void {
    props.actions.onAuthTokenDraftChange(
      (event.currentTarget as HTMLInputElement).value
    )
  }

  function handlePollIntervalInput(event: Event): void {
    props.actions.onPollIntervalChange(
      (event.currentTarget as HTMLInputElement).value
    )
  }

  function handleAutoSyncChange(event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) {
      return
    }

    props.actions.onAutoSyncChange(target.checked)
  }
</script>

<template>
  <div class="setting-group">
    <div class="setting-item setting-item-heading">
      <div class="setting-item-name">
        {{ t('settings.connection.heading') }}
      </div>
    </div>
    <div class="setting-items">
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.connection.serverUrl.label') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.connection.serverUrl.description') }}
          </div>
          <div class="setting-item-description obsidian-sync-inline-status">
            {{
              t('settings.connection.serverUrl.status', {
                status: props.model.connectionStatusText
              })
            }}
          </div>
        </div>
        <div class="setting-item-control">
          <input
            :value="props.model.serverUrl"
            autocomplete="url"
            autocapitalize="off"
            :placeholder="t('settings.connection.serverUrl.placeholder')"
            spellcheck="false"
            type="text"
            @input="handleServerUrlInput"
          />
          <button type="button" @click="props.actions.onCheckConnection">
            {{ t('settings.connection.serverUrl.check') }}
          </button>
        </div>
      </div>

      <div
        v-if="!props.model.unlocked || props.model.editingAuthToken"
        class="setting-item"
      >
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.connection.authToken.label') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.connection.authToken.description') }}
          </div>
          <div v-if="!props.model.unlocked" class="setting-item-description">
            {{ props.model.authGateMessage }}
          </div>
        </div>
        <div class="setting-item-control">
          <input
            :value="props.model.authTokenDraft"
            autocomplete="off"
            autocapitalize="off"
            :placeholder="t('settings.connection.authToken.placeholder')"
            spellcheck="false"
            type="password"
            @input="handleAuthTokenInput"
          />
          <button
            type="button"
            class="mod-cta"
            @click="props.actions.onAuthorize"
          >
            {{ t('settings.connection.authToken.authorize') }}
          </button>
          <button
            v-if="props.model.editingAuthToken"
            type="button"
            @click="props.actions.onCancelAuthEdit"
          >
            {{ t('settings.common.cancel') }}
          </button>
        </div>
      </div>
      <div v-else class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.connection.authToken.authorizedLabel') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.connection.authToken.authorizedDescription') }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button type="button" @click="props.actions.onStartAuthEdit">
            {{ t('settings.connection.authToken.change') }}
          </button>
          <button type="button" @click="props.actions.onSignOut">
            {{ t('settings.connection.authToken.signOut') }}
          </button>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.connection.deviceId.label') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.connection.deviceId.description') }}
          </div>
        </div>
        <div class="setting-item-control">
          <code>{{ props.model.deviceId }}</code>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.connection.pollInterval.label') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.connection.pollInterval.description') }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-single-control">
          <input
            :value="String(props.model.pollIntervalSecs)"
            inputmode="numeric"
            min="1"
            :placeholder="t('settings.connection.pollInterval.placeholder')"
            spellcheck="false"
            type="number"
            @input="handlePollIntervalInput"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.connection.autoSync.label') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.connection.autoSync.description') }}
          </div>
        </div>
        <div class="setting-item-control">
          <label class="checkbox-container">
            <input
              :checked="props.model.autoSync"
              type="checkbox"
              @change="handleAutoSyncChange"
            />
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, shallowRef, watch } from 'vue'

  import { buildE2eeStatusText, formatLastSyncAt } from '../ui'
  import type { SettingsActions, SettingsViewModel } from '../view-model'

  const props = defineProps<{
    model: SettingsViewModel
    actions: SettingsActions
  }>()

  const remoteJoinVaultId = shallowRef('')

  const availableJoinVaults = computed(() =>
    (props.model.remoteVaults ?? []).filter(
      (vault) => vault.vault_id !== props.model.currentVaultId
    )
  )

  const currentVaultOnServer = computed(
    () =>
      props.model.remoteVaults?.some(
        (vault) => vault.vault_id === props.model.currentVaultId
      ) ?? false
  )

  const serverRegistryStatus = computed(() => {
    if (!props.model.currentVaultId) {
      return 'Not connected'
    }
    if (props.model.remoteVaults) {
      return currentVaultOnServer.value ? 'Loaded' : 'Not loaded here'
    }
    if (props.model.loadingRemoteVaults) {
      return 'Loading...'
    }
    return props.model.remoteVaultsError ? 'Unavailable' : 'Not loaded'
  })

  const vaultRegistryDescription = computed(() => {
    if (props.model.loadingRemoteVaults) {
      return 'Loading vaults from the server...'
    }
    if (props.model.remoteVaultsError) {
      return `Vault list is unavailable: ${props.model.remoteVaultsError}`
    }
    if (props.model.remoteVaults) {
      if (props.model.remoteVaults.length === 0) {
        return 'No vaults exist on the server yet.'
      }
      if (props.model.currentVaultId && !currentVaultOnServer.value) {
        return `Loaded ${props.model.remoteVaults.length} vault(s). The current vault is not in the server registry.`
      }
      return `Loaded ${props.model.remoteVaults.length} vault(s) from the server.`
    }
    return 'Load vaults from the server to join an existing one.'
  })

  const e2eeStatusText = computed(() =>
    buildE2eeStatusText(props.model.e2eeFingerprint, props.model.e2eePassphrase)
  )

  watch(
    availableJoinVaults,
    (vaults) => {
      if (!vaults.some((vault) => vault.vault_id === remoteJoinVaultId.value)) {
        remoteJoinVaultId.value = vaults[0]?.vault_id ?? ''
      }
    },
    { immediate: true }
  )

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
    props.actions.onAutoSyncChange(
      (event.currentTarget as HTMLInputElement).checked
    )
  }

  function handleJoinVault(): void {
    if (!remoteJoinVaultId.value) {
      return
    }
    props.actions.onJoinVault(remoteJoinVaultId.value)
  }

  function handleIncludePatternsInput(event: Event): void {
    props.actions.onIncludePatternsChange(
      (event.currentTarget as HTMLTextAreaElement).value
    )
  }

  function handleIgnorePatternsInput(event: Event): void {
    props.actions.onIgnorePatternsChange(
      (event.currentTarget as HTMLTextAreaElement).value
    )
  }
</script>

<template>
  <div class="setting-group">
    <div class="setting-item setting-item-heading">
      <div class="setting-item-name">Connection</div>
    </div>
    <div class="setting-items">
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Server URL</div>
          <div class="setting-item-description">
            Base URL of the Rust sync server.
          </div>
          <div class="setting-item-description obsidian-sync-inline-status">
            Connection: {{ props.model.connectionStatusText }}
          </div>
        </div>
        <div class="setting-item-control">
          <input
            autocomplete="url"
            autocapitalize="off"
            placeholder="http://127.0.0.1:3000"
            spellcheck="false"
            type="text"
            :value="props.model.serverUrl"
            @input="handleServerUrlInput"
          />
          <button type="button" @click="props.actions.onCheckConnection">
            Check
          </button>
        </div>
      </div>

      <div
        v-if="!props.model.unlocked || props.model.editingAuthToken"
        class="setting-item"
      >
        <div class="setting-item-info">
          <div class="setting-item-name">Auth token</div>
          <div class="setting-item-description">
            Bearer token required by the sync server.
          </div>
          <div v-if="!props.model.unlocked" class="setting-item-description">
            {{ props.model.authGateMessage }}
          </div>
        </div>
        <div class="setting-item-control">
          <input
            autocomplete="off"
            autocapitalize="off"
            placeholder="secret-token"
            spellcheck="false"
            type="password"
            :value="props.model.authTokenDraft"
            @input="handleAuthTokenInput"
          />
          <button
            type="button"
            class="mod-cta"
            @click="props.actions.onAuthorize"
          >
            Authorize
          </button>
          <button
            v-if="props.model.editingAuthToken"
            type="button"
            @click="props.actions.onCancelAuthEdit"
          >
            Cancel
          </button>
        </div>
      </div>
      <div v-else class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Authorization</div>
          <div class="setting-item-description">
            Authorized with the current server token.
          </div>
        </div>
        <div class="setting-item-control">
          <button type="button" @click="props.actions.onStartAuthEdit">
            Change token
          </button>
          <button type="button" @click="props.actions.onSignOut">
            Sign out
          </button>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Device ID</div>
          <div class="setting-item-description">
            Stable identifier for this Obsidian installation.
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-code-control">
          <code>{{ props.model.deviceId }}</code>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Poll interval</div>
          <div class="setting-item-description">
            How often the plugin polls the server for remote changes.
          </div>
        </div>
        <div class="setting-item-control">
          <input
            inputmode="numeric"
            min="1"
            placeholder="2"
            spellcheck="false"
            type="number"
            :value="String(props.model.pollIntervalSecs)"
            @input="handlePollIntervalInput"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Auto sync</div>
          <div class="setting-item-description">
            Run the sync loop in the background.
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-toggle-control">
          <div class="checkbox-container">
            <input
              type="checkbox"
              :checked="props.model.autoSync"
              @change="handleAutoSyncChange"
            />
          </div>
        </div>
      </div>
    </div>
  </div>

  <template v-if="props.model.unlocked">
    <div class="setting-group">
      <div class="setting-item setting-item-heading">
        <div class="setting-item-name">Overview</div>
      </div>
      <div class="setting-items">
        <div class="setting-item obsidian-sync-panel">
          <div class="obsidian-sync-status-header">
            <div class="obsidian-sync-status-copy">
              <div class="obsidian-sync-section-subtitle">Sync status</div>
              <div class="setting-item-description">
                <template
                  v-if="props.model.lastSyncErrorText !== 'No recent errors'"
                >
                  Attention required. {{ props.model.lastSyncErrorText }}
                </template>
                <template v-else>
                  Tracking {{ props.model.trackedFilesCount }} file(s). Last
                  successful sync:
                  {{ formatLastSyncAt(props.model.lastSyncAt) }}.
                </template>
              </div>
            </div>
            <div class="obsidian-sync-badges">
              <span
                class="obsidian-sync-badge"
                :class="
                  props.model.lastSyncErrorText === 'No recent errors'
                    ? 'obsidian-sync-badge-ok'
                    : 'obsidian-sync-badge-error'
                "
              >
                {{
                  props.model.lastSyncErrorText === 'No recent errors'
                    ? 'Healthy'
                    : 'Needs attention'
                }}
              </span>
              <span
                class="obsidian-sync-badge"
                :class="
                  props.model.e2eeFingerprint
                    ? props.model.e2eePassphrase.trim()
                      ? 'obsidian-sync-badge-ok'
                      : 'obsidian-sync-badge-warn'
                    : props.model.e2eePassphrase.trim()
                      ? 'obsidian-sync-badge-warn'
                      : 'obsidian-sync-badge-muted'
                "
              >
                <template v-if="props.model.e2eeFingerprint">
                  {{
                    props.model.e2eePassphrase.trim()
                      ? 'E2EE loaded'
                      : 'E2EE locked'
                  }}
                </template>
                <template v-else>
                  {{
                    props.model.e2eePassphrase.trim()
                      ? 'E2EE pending'
                      : 'E2EE off'
                  }}
                </template>
              </span>
            </div>
          </div>
          <div class="obsidian-sync-key-value-row">
            <span class="obsidian-sync-key-value-label">Vault</span>
            <span class="obsidian-sync-key-value-value">{{
              props.model.currentVaultId || 'Not connected'
            }}</span>
          </div>
          <div class="obsidian-sync-key-value-row">
            <span class="obsidian-sync-key-value-label">Server</span>
            <span class="obsidian-sync-key-value-value">{{
              props.model.serverUrl || 'Not configured'
            }}</span>
          </div>
          <div class="obsidian-sync-key-value-row">
            <span class="obsidian-sync-key-value-label">Files tracked</span>
            <span class="obsidian-sync-key-value-value">{{
              props.model.trackedFilesCount
            }}</span>
          </div>
          <div class="obsidian-sync-key-value-row">
            <span class="obsidian-sync-key-value-label">Deletes tracked</span>
            <span class="obsidian-sync-key-value-value">{{
              props.model.deletedFilesCount
            }}</span>
          </div>
          <div class="obsidian-sync-key-value-row">
            <span class="obsidian-sync-key-value-label">Last sync</span>
            <span class="obsidian-sync-key-value-value">{{
              formatLastSyncAt(props.model.lastSyncAt)
            }}</span>
          </div>
          <div class="obsidian-sync-key-value-row">
            <span class="obsidian-sync-key-value-label">Last issue</span>
            <span class="obsidian-sync-key-value-value">{{
              props.model.lastSyncErrorText
            }}</span>
          </div>
          <div class="obsidian-sync-key-value-row">
            <span class="obsidian-sync-key-value-label">E2EE</span>
            <span class="obsidian-sync-key-value-value">{{
              e2eeStatusText
            }}</span>
          </div>
        </div>

        <div class="setting-item obsidian-sync-inline-status-row">
          <div class="setting-item-description obsidian-sync-inline-status">
            Quick actions: {{ props.model.quickActionsStatusText }}
          </div>
        </div>

        <div class="setting-item obsidian-sync-quick-actions">
          <button
            type="button"
            class="mod-cta"
            @click="props.actions.onSyncNow"
          >
            Sync now
          </button>
          <button type="button" @click="props.actions.onCheckConnection">
            Check connection
          </button>
          <button type="button" @click="props.actions.onRefreshDevices">
            Refresh devices
          </button>
        </div>
      </div>
    </div>

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

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Current vault</div>
            <div class="setting-item-description">
              Connected vault:
              {{ props.model.currentVaultId || 'Not connected' }}. Server
              registry: {{ serverRegistryStatus }}.
            </div>
          </div>
          <div class="setting-item-control">
            <button
              type="button"
              :disabled="!props.model.currentVaultId"
              @click="props.actions.onDisconnectVault"
            >
              {{
                props.model.confirmDisconnect
                  ? 'Confirm disconnect'
                  : 'Disconnect'
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
                  ? 'Confirm forget'
                  : 'Forget local state'
              }}
            </button>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Server vaults</div>
            <div class="setting-item-description">
              {{ vaultRegistryDescription }}
            </div>
          </div>
          <div class="setting-item-control">
            <button
              type="button"
              :disabled="props.model.loadingRemoteVaults"
              @click="props.actions.onLoadVaults"
            >
              Load vaults
            </button>
            <button
              type="button"
              class="mod-cta"
              :disabled="
                !props.model.currentVaultId ||
                !props.model.remoteVaults ||
                currentVaultOnServer
              "
              @click="props.actions.onCreateCurrentVault"
            >
              Create current
            </button>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Create vault</div>
            <div class="setting-item-description">
              {{
                props.model.currentVaultId
                  ? 'Create a new vault on the server and reconnect this folder to it.'
                  : 'Create a new vault on the server and connect this folder to it.'
              }}
            </div>
          </div>
          <div class="setting-item-control obsidian-sync-action-control">
            <button
              type="button"
              class="mod-cta"
              @click="props.actions.onCreateVault"
            >
              Create vault
            </button>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">
              {{
                props.model.currentVaultId
                  ? 'Reconnect this folder'
                  : 'Join server vault'
              }}
            </div>
            <div class="setting-item-description">
              <template v-if="props.model.remoteVaults">
                {{
                  props.model.currentVaultId
                    ? 'Reconnect this folder to a vault discovered on the server.'
                    : 'Connect this folder to a vault discovered on the server.'
                }}
              </template>
              <template v-else-if="props.model.loadingRemoteVaults"
                >Loading vaults from the server...</template
              >
              <template v-else>Load vaults from the server first.</template>
            </div>
          </div>
          <div class="setting-item-control">
            <select v-model="remoteJoinVaultId">
              <option v-if="availableJoinVaults.length === 0" value="">
                {{
                  props.model.loadingRemoteVaults
                    ? 'Loading...'
                    : 'No loaded vaults'
                }}
              </option>
              <option
                v-for="vault in availableJoinVaults"
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
              Join
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-item setting-item-heading">
        <div class="setting-item-name">Sync Scope</div>
      </div>
      <div class="setting-items">
        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Include patterns</div>
            <div class="setting-item-description">
              Optional allow-list. If set, only matching paths are synced. Same
              pattern syntax as ignore rules.
            </div>
          </div>
          <div class="setting-item-control obsidian-sync-textarea-control">
            <textarea
              rows="5"
              spellcheck="false"
              placeholder="Notes/\n*.md"
              :value="props.model.includePatterns.join('\n')"
              @input="handleIncludePatternsInput"
            />
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Ignore patterns</div>
            <div class="setting-item-description">
              One pattern per line. Supports '*', '?', and folder prefixes
              ending with '/'.
            </div>
          </div>
          <div class="setting-item-control obsidian-sync-textarea-control">
            <textarea
              rows="5"
              spellcheck="false"
              placeholder=".obsidian/\nTemplates/\n*.canvas"
              :value="props.model.ignorePatterns.join('\n')"
              @input="handleIgnorePatternsInput"
            />
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

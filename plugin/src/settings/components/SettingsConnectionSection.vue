<script setup lang="ts">
import type { SettingsActions, SettingsViewModel } from "../view-model";

const props = defineProps<{
  model: SettingsViewModel;
  actions: SettingsActions;
}>();

function handleServerUrlInput(event: Event): void {
  props.actions.onServerUrlChange((event.currentTarget as HTMLInputElement).value);
}

function handleAuthTokenInput(event: Event): void {
  props.actions.onAuthTokenDraftChange((event.currentTarget as HTMLInputElement).value);
}

function handlePollIntervalInput(event: Event): void {
  props.actions.onPollIntervalChange((event.currentTarget as HTMLInputElement).value);
}

function handleAutoSyncChange(event: Event): void {
  props.actions.onAutoSyncChange((event.currentTarget as HTMLInputElement).checked);
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
          <div class="setting-item-description">Base URL of the Rust sync server.</div>
          <div class="setting-item-description obsidian-sync-inline-status">
            Connection: {{ props.model.connectionStatusText }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-field-controls">
          <input
            :value="props.model.serverUrl"
            autocomplete="url"
            autocapitalize="off"
            placeholder="http://127.0.0.1:3000"
            spellcheck="false"
            type="text"
            @input="handleServerUrlInput"
          >
          <button type="button" @click="props.actions.onCheckConnection">Check</button>
        </div>
      </div>

      <div
        v-if="!props.model.unlocked || props.model.editingAuthToken"
        class="setting-item obsidian-sync-with-top-border"
      >
        <div class="setting-item-info">
          <div class="setting-item-name">Auth token</div>
          <div class="setting-item-description">Bearer token required by the sync server.</div>
          <div v-if="!props.model.unlocked" class="setting-item-description">
            {{ props.model.authGateMessage }}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-field-controls">
          <input
            :value="props.model.authTokenDraft"
            autocomplete="off"
            autocapitalize="off"
            placeholder="secret-token"
            spellcheck="false"
            type="password"
            @input="handleAuthTokenInput"
          >
          <button type="button" class="mod-cta" @click="props.actions.onAuthorize">Authorize</button>
          <button
            v-if="props.model.editingAuthToken"
            type="button"
            @click="props.actions.onCancelAuthEdit"
          >
            Cancel
          </button>
        </div>
      </div>
      <div v-else class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Authorization</div>
          <div class="setting-item-description">Authorized with the current server token.</div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button type="button" @click="props.actions.onStartAuthEdit">Change token</button>
          <button type="button" @click="props.actions.onSignOut">Sign out</button>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Device ID</div>
          <div class="setting-item-description">Stable identifier for this Obsidian installation.</div>
        </div>
        <div class="setting-item-control obsidian-sync-code-control">
          <code>{{ props.model.deviceId }}</code>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Poll interval</div>
          <div class="setting-item-description">How often the plugin polls the server for remote changes.</div>
        </div>
        <div class="setting-item-control obsidian-sync-single-control">
          <input
            :value="String(props.model.pollIntervalSecs)"
            inputmode="numeric"
            min="1"
            placeholder="2"
            spellcheck="false"
            type="number"
            @input="handlePollIntervalInput"
          >
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Auto sync</div>
          <div class="setting-item-description">Run the sync loop in the background.</div>
        </div>
        <div class="setting-item-control obsidian-sync-toggle-control">
          <div class="checkbox-container">
            <input :checked="props.model.autoSync" type="checkbox" @change="handleAutoSyncChange">
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

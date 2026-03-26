<script setup lang="ts">
import { computed } from "vue";

import { buildE2eeStatusText, formatLastSyncAt } from "../ui";
import type { SettingsActions, SettingsViewModel } from "../view-model";

const props = defineProps<{
  model: SettingsViewModel;
  actions: SettingsActions;
}>();

const e2eeBadgeClass = computed(() => {
  if (props.model.e2eeFingerprint) {
    return props.model.e2eePassphrase.trim()
      ? "obsidian-sync-badge-ok"
      : "obsidian-sync-badge-warn";
  }

  return props.model.e2eePassphrase.trim()
    ? "obsidian-sync-badge-warn"
    : "obsidian-sync-badge-muted";
});

const e2eeBadgeText = computed(() => {
  if (props.model.e2eeFingerprint) {
    return props.model.e2eePassphrase.trim() ? "E2EE loaded" : "E2EE locked";
  }

  return props.model.e2eePassphrase.trim() ? "E2EE pending" : "E2EE off";
});

const e2eeStatusText = computed(() =>
  buildE2eeStatusText(props.model.e2eeFingerprint, props.model.e2eePassphrase),
);
</script>

<template>
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
              <template v-if="props.model.lastSyncErrorText !== 'No recent errors'">
                Attention required. {{ props.model.lastSyncErrorText }}
              </template>
              <template v-else>
                Tracking {{ props.model.trackedFilesCount }} file(s). Last successful sync:
                {{ formatLastSyncAt(props.model.lastSyncAt) }}.
              </template>
            </div>
          </div>
          <div class="obsidian-sync-badges">
            <span
              class="obsidian-sync-badge"
              :class="props.model.lastSyncErrorText === 'No recent errors' ? 'obsidian-sync-badge-ok' : 'obsidian-sync-badge-error'"
            >
              {{ props.model.lastSyncErrorText === "No recent errors" ? "Healthy" : "Needs attention" }}
            </span>
            <span class="obsidian-sync-badge" :class="e2eeBadgeClass">
              {{ e2eeBadgeText }}
            </span>
          </div>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Vault</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.currentVaultId || "Not connected" }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Server</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.serverUrl || "Not configured" }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Files tracked</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.trackedFilesCount }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Deletes tracked</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.deletedFilesCount }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Last sync</span>
          <span class="obsidian-sync-key-value-value">{{ formatLastSyncAt(props.model.lastSyncAt) }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Last issue</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.lastSyncErrorText }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">E2EE</span>
          <span class="obsidian-sync-key-value-value">{{ e2eeStatusText }}</span>
        </div>
      </div>

      <div class="setting-item obsidian-sync-inline-status-row obsidian-sync-with-top-border">
        <div class="setting-item-description obsidian-sync-inline-status">
          Quick actions: {{ props.model.quickActionsStatusText }}
        </div>
      </div>

      <div class="setting-item obsidian-sync-quick-actions obsidian-sync-with-top-border">
        <button type="button" class="mod-cta" @click="props.actions.onSyncNow">Sync now</button>
        <button type="button" @click="props.actions.onCheckConnection">Check connection</button>
        <button type="button" @click="props.actions.onRefreshDevices">Refresh devices</button>
      </div>
    </div>
  </div>
</template>

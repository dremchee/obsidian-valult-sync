<script setup lang="ts">
import { computed } from "vue";

import { t } from "../../i18n";
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
    return props.model.e2eePassphrase.trim()
      ? t("settings.overview.e2eeLoaded")
      : t("settings.overview.e2eeLocked");
  }

  return props.model.e2eePassphrase.trim()
    ? t("settings.overview.e2eePending")
    : t("settings.overview.e2eeOff");
});

const e2eeStatusText = computed(() =>
  buildE2eeStatusText(props.model.e2eeFingerprint, props.model.e2eePassphrase),
);

const noRecentErrorsText = computed(() =>
  t("sync.errors.noRecentErrors"),
);

const hasSyncError = computed(() => props.model.lastSyncErrorText !== noRecentErrorsText.value);
</script>

<template>
  <div class="setting-group">
    <div class="setting-item setting-item-heading">
      <div class="setting-item-name">{{ t("settings.overview.heading") }}</div>
    </div>
    <div class="setting-items">
      <div class="setting-item obsidian-sync-panel">
        <div class="obsidian-sync-status-header">
          <div class="obsidian-sync-status-copy">
            <div class="obsidian-sync-section-subtitle">{{ t("settings.overview.syncStatus") }}</div>
            <div class="setting-item-description">
              <template v-if="hasSyncError">
                {{ t("settings.overview.attention", { message: props.model.lastSyncErrorText }) }}
              </template>
              <template v-else>
                {{ t("settings.overview.tracking", {
                  count: props.model.trackedFilesCount,
                  time: formatLastSyncAt(props.model.lastSyncAt),
                }) }}
              </template>
            </div>
          </div>
          <div class="obsidian-sync-badges">
            <span
              class="obsidian-sync-badge"
              :class="hasSyncError ? 'obsidian-sync-badge-error' : 'obsidian-sync-badge-ok'"
            >
              {{ hasSyncError
                ? t("settings.overview.needsAttention")
                : t("settings.overview.healthy") }}
            </span>
            <span class="obsidian-sync-badge" :class="e2eeBadgeClass">
              {{ e2eeBadgeText }}
            </span>
          </div>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">{{ t("settings.overview.vault") }}</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.currentVaultId || t("settings.common.notConnected") }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">{{ t("settings.overview.server") }}</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.serverUrl || t("sync.errors.invalidSettingsServerUrl") }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">{{ t("settings.overview.filesTracked") }}</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.trackedFilesCount }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">{{ t("settings.overview.deletesTracked") }}</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.deletedFilesCount }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">{{ t("settings.overview.lastSync") }}</span>
          <span class="obsidian-sync-key-value-value">{{ formatLastSyncAt(props.model.lastSyncAt) }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">{{ t("settings.overview.lastIssue") }}</span>
          <span class="obsidian-sync-key-value-value">{{ props.model.lastSyncErrorText }}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">{{ t("settings.overview.e2ee") }}</span>
          <span class="obsidian-sync-key-value-value">{{ e2eeStatusText }}</span>
        </div>
      </div>

      <div class="setting-item obsidian-sync-inline-status-row obsidian-sync-with-top-border">
        <div class="setting-item-description obsidian-sync-inline-status">
          {{ t("settings.overview.quickActions", { status: props.model.quickActionsStatusText }) }}
        </div>
      </div>

      <div class="setting-item obsidian-sync-quick-actions obsidian-sync-with-top-border">
        <button type="button" class="mod-cta" @click="props.actions.onSyncNow">{{ t("settings.overview.syncNow") }}</button>
        <button type="button" @click="props.actions.onCheckConnection">{{ t("settings.overview.checkConnection") }}</button>
        <button type="button" @click="props.actions.onRefreshDevices">{{ t("settings.overview.refreshDevices") }}</button>
      </div>
    </div>
  </div>
</template>

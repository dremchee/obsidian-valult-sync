<script setup lang="ts">
import type { FileVersionItem } from "../../types";
import { t } from "../../i18n";
import type { HistoryState } from "../file-history-types";

const props = defineProps<{
  currentVersion: number;
  state: HistoryState;
  restoringVersion: number | null;
}>();

const emit = defineEmits<{
  restore: [version: number];
}>();

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function buildVersionDescription(version: FileVersionItem): string {
  const parts = [
    version.created_at
      ? formatTimestamp(version.created_at)
      : t("modal.fileHistory.unknownTime"),
    version.deleted
      ? t("modal.fileHistory.tombstone")
      : version.content_format,
  ];

  if (version.version === props.currentVersion) {
    parts.unshift(t("modal.fileHistory.currentVersion"));
  }

  return parts.join(" • ");
}
</script>

<template>
  <p v-if="props.state.kind === 'loading'" class="setting-item-description">{{ t("modal.fileHistory.loading") }}</p>
  <p v-else-if="props.state.kind === 'error'" class="setting-item-description">
    {{ t("modal.fileHistory.loadFailed", { message: props.state.message }) }}
  </p>
  <p v-else-if="props.state.versions.length === 0" class="setting-item-description">
    {{ t("modal.fileHistory.empty") }}
  </p>
  <div v-else class="obsidian-sync-history-list">
    <div v-for="version in props.state.versions" :key="version.version" class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">{{ t("modal.fileHistory.version", { version: version.version }) }}</div>
        <div class="setting-item-description">{{ buildVersionDescription(version) }}</div>
      </div>
      <div class="setting-item-control">
        <button v-if="version.version === props.currentVersion" type="button" disabled>{{ t("modal.fileHistory.current") }}</button>
        <button
          v-else
          type="button"
          :disabled="props.restoringVersion === version.version"
          @click="emit('restore', version.version)"
        >
          {{ props.restoringVersion === version.version
            ? t("modal.fileHistory.restoring")
            : t("modal.fileHistory.restore") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FileVersionItem } from "../../types";
import type { HistoryState } from "../file-history-types";

const props = defineProps<{
  currentVersion: number;
  state: HistoryState;
  restoringVersion: number | null;
  onRestore: (version: number) => void;
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
    version.created_at ? formatTimestamp(version.created_at) : "Unknown time",
    version.deleted ? "tombstone" : version.content_format,
  ];

  if (version.version === props.currentVersion) {
    parts.unshift("Current version");
  }

  return parts.join(" • ");
}
</script>

<template>
  <p v-if="props.state.kind === 'loading'" class="setting-item-description">Loading server history...</p>
  <p v-else-if="props.state.kind === 'error'" class="setting-item-description">
    Failed to load server history: {{ props.state.message }}
  </p>
  <p v-else-if="props.state.versions.length === 0" class="setting-item-description">
    No server history is available for this file yet.
  </p>
  <div v-else class="obsidian-sync-history-list">
    <div v-for="version in props.state.versions" :key="version.version" class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Version {{ version.version }}</div>
        <div class="setting-item-description">{{ buildVersionDescription(version) }}</div>
      </div>
      <div class="setting-item-control">
        <button v-if="version.version === props.currentVersion" type="button" disabled>Current</button>
        <button
          v-else
          type="button"
          :disabled="props.restoringVersion === version.version"
          @click="props.onRestore(version.version)"
        >
          {{ props.restoringVersion === version.version ? "Restoring..." : "Restore" }}
        </button>
      </div>
    </div>
  </div>
</template>

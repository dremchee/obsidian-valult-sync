<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from "vue";
import { setIcon } from "obsidian";

import type { StatusBarSnapshot, StatusBarState } from "../status-bar";

const props = defineProps<{
  snapshot: StatusBarSnapshot;
}>();

const iconEl = useTemplateRef<HTMLElement>("iconEl");

function iconForState(state: StatusBarState): string {
  if (state === "syncing") {
    return "refresh-cw";
  }
  if (state === "pending") {
    return "clock-3";
  }
  if (state === "error") {
    return "alert-triangle";
  }
  if (state === "disabled") {
    return "pause-circle";
  }
  return "check-circle";
}

function formatLastSync(value: number | null): string {
  if (value === null) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const iconName = computed(() => iconForState(props.snapshot.state));

const title = computed(() =>
  [
    `Status: ${props.snapshot.statusText}`,
    `Vault: ${props.snapshot.vaultId}`,
    `Last sync: ${formatLastSync(props.snapshot.lastSyncAt)}`,
    ...(props.snapshot.lastError ? [`Last issue: ${props.snapshot.lastError}`] : []),
  ].join("\n"),
);

function updateIcon(name: string): void {
  if (!iconEl.value) {
    return;
  }
  setIcon(iconEl.value, name);
}

onMounted(() => {
  updateIcon(iconName.value);
});

watch(iconName, (value) => {
  updateIcon(value);
});
</script>

<template>
  <div class="obsidian-sync-status-bar" :title="title">
    <span ref="iconEl" class="obsidian-sync-status-icon" />
  </div>
</template>

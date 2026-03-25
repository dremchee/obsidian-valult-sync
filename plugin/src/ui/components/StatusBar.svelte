<script lang="ts">
  import { setIcon } from "obsidian";
  import type { StatusBarSnapshot, StatusBarState } from "../status-bar";

  export let snapshot: StatusBarSnapshot;

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

  function icon(node: HTMLElement, name: string): { update: (nextName: string) => void } {
    setIcon(node, name);
    return {
      update(nextName: string) {
        setIcon(node, nextName);
      },
    };
  }

  $: title = [
    `Status: ${snapshot.statusText}`,
    `Vault: ${snapshot.vaultId}`,
    `Last sync: ${formatLastSync(snapshot.lastSyncAt)}`,
    ...(snapshot.lastError ? [`Last issue: ${snapshot.lastError}`] : []),
  ].join("\n");
</script>

<div class="obsidian-sync-status-bar" title={title}>
  <span class="obsidian-sync-status-icon" use:icon={iconForState(snapshot.state)}></span>
</div>

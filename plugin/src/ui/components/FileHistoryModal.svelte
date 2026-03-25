<script lang="ts">
  import type { FileVersionItem } from "../../types";
  import type { HistoryState } from "../file-history-types";

  export let currentVersion: number;
  export let state: HistoryState;
  export let restoringVersion: number | null;
  export let onRestore: (version: number) => void;

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

    if (version.version === currentVersion) {
      parts.unshift("Current version");
    }

    return parts.join(" • ");
  }
</script>

{#if state.kind === "loading"}
  <p class="setting-item-description">Loading server history...</p>
{:else if state.kind === "error"}
  <p class="setting-item-description">Failed to load server history: {state.message}</p>
{:else if state.versions.length === 0}
  <p class="setting-item-description">No server history is available for this file yet.</p>
{:else}
  <div class="obsidian-sync-history-list">
    {#each state.versions as version (version.version)}
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">Version {version.version}</div>
          <div class="setting-item-description">{buildVersionDescription(version)}</div>
        </div>
        <div class="setting-item-control">
          {#if version.version === currentVersion}
            <button type="button" disabled>Current</button>
          {:else}
            <button
              type="button"
              disabled={restoringVersion === version.version}
              on:click={() => onRestore(version.version)}
            >
              {restoringVersion === version.version ? "Restoring..." : "Restore"}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

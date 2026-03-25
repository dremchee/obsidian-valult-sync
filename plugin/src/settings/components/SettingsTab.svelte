<script lang="ts">
  import { buildE2eeStatusText, formatLastSyncAt } from "../ui";
  import type { SettingsActions, SettingsViewModel } from "../view-model";

  export let model: SettingsViewModel;
  export let actions: SettingsActions;

  let remoteJoinVaultId = "";

  $: availableJoinVaults = (model.remoteVaults ?? []).filter(
    (vault) => vault.vault_id !== model.currentVaultId,
  );
  $: if (!availableJoinVaults.some((vault) => vault.vault_id === remoteJoinVaultId)) {
    remoteJoinVaultId = availableJoinVaults[0]?.vault_id ?? "";
  }
  $: currentVaultOnServer = model.remoteVaults?.some((vault) => vault.vault_id === model.currentVaultId) ?? false;
  $: serverRegistryStatus = !model.currentVaultId
    ? "Not connected"
    : model.remoteVaults
      ? currentVaultOnServer ? "Loaded" : "Not loaded here"
      : model.loadingRemoteVaults ? "Loading..." : model.remoteVaultsError ? "Unavailable" : "Not loaded";
  $: vaultRegistryDescription = model.loadingRemoteVaults
    ? "Loading vaults from the server..."
    : model.remoteVaultsError
      ? `Vault list is unavailable: ${model.remoteVaultsError}`
      : model.remoteVaults
        ? model.remoteVaults.length === 0
          ? "No vaults exist on the server yet."
          : model.currentVaultId && !currentVaultOnServer
            ? `Loaded ${model.remoteVaults.length} vault(s). The current vault is not in the server registry.`
            : `Loaded ${model.remoteVaults.length} vault(s) from the server.`
        : "Load vaults from the server to join an existing one.";
  $: e2eeStatusText = buildE2eeStatusText(model.e2eeFingerprint, model.e2eePassphrase);
</script>

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
          Connection: {model.connectionStatusText}
        </div>
      </div>
      <div class="setting-item-control obsidian-sync-field-controls">
        <input
          class="prompt-input"
          placeholder="http://127.0.0.1:3000"
          value={model.serverUrl}
          on:input={(event) => actions.onServerUrlChange((event.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" on:click={actions.onCheckConnection}>Check</button>
      </div>
    </div>

    {#if !model.unlocked || model.editingAuthToken}
      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Auth token</div>
          <div class="setting-item-description">Bearer token required by the sync server.</div>
          {#if !model.unlocked}
            <div class="setting-item-description">{model.authGateMessage}</div>
          {/if}
        </div>
        <div class="setting-item-control obsidian-sync-field-controls">
          <input
            class="prompt-input"
            placeholder="secret-token"
            value={model.authTokenDraft}
            on:input={(event) => actions.onAuthTokenDraftChange((event.currentTarget as HTMLInputElement).value)}
          />
          <button type="button" class="mod-cta" on:click={actions.onAuthorize}>Authorize</button>
          {#if model.editingAuthToken}
            <button type="button" on:click={actions.onCancelAuthEdit}>Cancel</button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Authorization</div>
          <div class="setting-item-description">Authorized with the current server token.</div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button type="button" on:click={actions.onStartAuthEdit}>Change token</button>
          <button type="button" on:click={actions.onSignOut}>Sign out</button>
        </div>
      </div>
    {/if}

    <div class="setting-item obsidian-sync-with-top-border">
      <div class="setting-item-info">
        <div class="setting-item-name">Device ID</div>
        <div class="setting-item-description">Stable identifier for this Obsidian installation.</div>
      </div>
      <div class="setting-item-control">
        <code>{model.deviceId}</code>
      </div>
    </div>

    <div class="setting-item obsidian-sync-with-top-border">
      <div class="setting-item-info">
        <div class="setting-item-name">Poll interval</div>
        <div class="setting-item-description">How often the plugin polls the server for remote changes.</div>
      </div>
      <div class="setting-item-control">
        <input
          class="prompt-input"
          placeholder="2"
          value={String(model.pollIntervalSecs)}
          on:input={(event) => actions.onPollIntervalChange((event.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </div>

    <div class="setting-item obsidian-sync-with-top-border">
      <div class="setting-item-info">
        <div class="setting-item-name">Auto sync</div>
        <div class="setting-item-description">Run the sync loop in the background.</div>
      </div>
      <div class="setting-item-control">
        <input
          type="checkbox"
          checked={model.autoSync}
          on:change={(event) => actions.onAutoSyncChange((event.currentTarget as HTMLInputElement).checked)}
        />
      </div>
    </div>
  </div>
</div>

{#if model.unlocked}
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
              {#if model.lastSyncErrorText !== "No recent errors"}
                Attention required. {model.lastSyncErrorText}
              {:else}
                Tracking {model.trackedFilesCount} file(s). Last successful sync: {formatLastSyncAt(model.lastSyncAt)}.
              {/if}
            </div>
          </div>
          <div class="obsidian-sync-badges">
            <span class={`obsidian-sync-badge ${model.lastSyncErrorText === "No recent errors" ? "obsidian-sync-badge-ok" : "obsidian-sync-badge-error"}`}>
              {model.lastSyncErrorText === "No recent errors" ? "Healthy" : "Needs attention"}
            </span>
            <span class={`obsidian-sync-badge ${
              model.e2eeFingerprint
                ? model.e2eePassphrase.trim() ? "obsidian-sync-badge-ok" : "obsidian-sync-badge-warn"
                : model.e2eePassphrase.trim() ? "obsidian-sync-badge-warn" : "obsidian-sync-badge-muted"
            }`}>
              {#if model.e2eeFingerprint}
                {model.e2eePassphrase.trim() ? "E2EE loaded" : "E2EE locked"}
              {:else}
                {model.e2eePassphrase.trim() ? "E2EE pending" : "E2EE off"}
              {/if}
            </span>
          </div>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Vault</span>
          <span class="obsidian-sync-key-value-value">{model.currentVaultId || "Not connected"}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Server</span>
          <span class="obsidian-sync-key-value-value">{model.serverUrl || "Not configured"}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Files tracked</span>
          <span class="obsidian-sync-key-value-value">{model.trackedFilesCount}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Deletes tracked</span>
          <span class="obsidian-sync-key-value-value">{model.deletedFilesCount}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Last sync</span>
          <span class="obsidian-sync-key-value-value">{formatLastSyncAt(model.lastSyncAt)}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">Last issue</span>
          <span class="obsidian-sync-key-value-value">{model.lastSyncErrorText}</span>
        </div>
        <div class="obsidian-sync-key-value-row">
          <span class="obsidian-sync-key-value-label">E2EE</span>
          <span class="obsidian-sync-key-value-value">{e2eeStatusText}</span>
        </div>
      </div>

      <div class="setting-item obsidian-sync-inline-status-row obsidian-sync-with-top-border">
        <div class="setting-item-description obsidian-sync-inline-status">
          Quick actions: {model.quickActionsStatusText}
        </div>
      </div>

      <div class="setting-item obsidian-sync-quick-actions obsidian-sync-with-top-border">
        <button type="button" class="mod-cta" on:click={actions.onSyncNow}>Sync now</button>
        <button type="button" on:click={actions.onCheckConnection}>Check connection</button>
        <button type="button" on:click={actions.onRefreshDevices}>Refresh devices</button>
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
          Vault registry: {model.vaultStatusText}
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Current vault</div>
          <div class="setting-item-description">
            Connected vault: {model.currentVaultId || "Not connected"}. Server registry: {serverRegistryStatus}.
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button type="button" disabled={!model.currentVaultId} on:click={actions.onDisconnectVault}>
            {model.confirmDisconnect ? "Confirm disconnect" : "Disconnect"}
          </button>
          <button
            type="button"
            class="mod-warning"
            disabled={!model.currentVaultId}
            on:click={actions.onForgetLocalState}
          >
            {model.confirmForget ? "Confirm forget" : "Forget local state"}
          </button>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Server vaults</div>
          <div class="setting-item-description">{vaultRegistryDescription}</div>
        </div>
        <div class="setting-item-control obsidian-sync-button-row">
          <button type="button" disabled={model.loadingRemoteVaults} on:click={actions.onLoadVaults}>
            Load vaults
          </button>
          <button
            type="button"
            class="mod-cta"
            disabled={!model.currentVaultId || !model.remoteVaults || currentVaultOnServer}
            on:click={actions.onCreateCurrentVault}
          >
            Create current
          </button>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Create vault</div>
          <div class="setting-item-description">
            {model.currentVaultId
              ? "Create a new vault on the server and reconnect this folder to it."
              : "Create a new vault on the server and connect this folder to it."}
          </div>
        </div>
        <div class="setting-item-control">
          <button type="button" class="mod-cta" on:click={actions.onCreateVault}>Create vault</button>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {model.currentVaultId ? "Reconnect this folder" : "Join server vault"}
          </div>
          <div class="setting-item-description">
            {#if model.remoteVaults}
              {model.currentVaultId
                ? "Reconnect this folder to a vault discovered on the server."
                : "Connect this folder to a vault discovered on the server."}
            {:else if model.loadingRemoteVaults}
              Loading vaults from the server...
            {:else}
              Load vaults from the server first.
            {/if}
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-field-controls">
          <select bind:value={remoteJoinVaultId}>
            {#if availableJoinVaults.length === 0}
              <option value="">
                {model.loadingRemoteVaults ? "Loading..." : "No loaded vaults"}
              </option>
            {:else}
              {#each availableJoinVaults as vault (vault.vault_id)}
                <option value={vault.vault_id}>{vault.vault_id}</option>
              {/each}
            {/if}
          </select>
          <button
            type="button"
            disabled={!remoteJoinVaultId}
            on:click={() => actions.onJoinVault(remoteJoinVaultId)}
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
            Optional allow-list. If set, only matching paths are synced. Same pattern syntax as ignore rules.
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-textarea-control">
          <textarea
            class="prompt-input"
            rows="5"
            placeholder={"Notes/\n*.md"}
            value={model.includePatterns.join("\n")}
            on:input={(event) => actions.onIncludePatternsChange((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">Ignore patterns</div>
          <div class="setting-item-description">
            One pattern per line. Supports '*', '?', and folder prefixes ending with '/'.
          </div>
        </div>
        <div class="setting-item-control obsidian-sync-textarea-control">
          <textarea
            class="prompt-input"
            rows="5"
            placeholder={".obsidian/\nTemplates/\n*.canvas"}
            value={model.ignorePatterns.join("\n")}
            on:input={(event) => actions.onIgnorePatternsChange((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
      </div>
    </div>
  </div>
{/if}

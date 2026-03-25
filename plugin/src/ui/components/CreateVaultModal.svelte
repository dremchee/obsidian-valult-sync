<script lang="ts">
  import { onMount } from "svelte";

  export let initialVaultId: string;
  export let onSubmit: (result: { vaultId: string; passphrase: string }) => void;
  export let onCancel: () => void;

  let vaultId = initialVaultId;
  let passphrase = "";
  let confirmPassphrase = "";
  let error = "";
  let vaultInput: HTMLInputElement | null = null;

  onMount(() => {
    vaultInput?.focus();
  });

  function clearError(): void {
    error = "";
  }

  function submit(): void {
    const normalizedVaultId = vaultId.trim();
    const normalizedPassphrase = passphrase.trim();

    if (!normalizedVaultId) {
      error = "Enter a vault name.";
      return;
    }

    if (!normalizedPassphrase) {
      error = "Enter an E2EE passphrase to create this vault.";
      return;
    }

    if (normalizedPassphrase !== confirmPassphrase.trim()) {
      error = "Passphrases do not match.";
      return;
    }

    onSubmit({
      vaultId: normalizedVaultId,
      passphrase,
    });
  }

  function handleEnter(event: KeyboardEvent): void {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submit();
  }
</script>

<div class="obsidian-sync-modal-copy">
  <p class="setting-item-description">
    Enter a vault name and an E2EE passphrase for the new vault.
  </p>
</div>

<label class="obsidian-sync-form-row">
  <span class="obsidian-sync-form-label">Vault name</span>
  <span class="setting-item-description">Used as the server-side vault ID for this folder.</span>
  <input
    bind:this={vaultInput}
    class="prompt-input"
    placeholder="team_notes"
    bind:value={vaultId}
    on:input={clearError}
    on:keydown={handleEnter}
  />
</label>

<label class="obsidian-sync-form-row">
  <span class="obsidian-sync-form-label">E2EE passphrase</span>
  <span class="setting-item-description">Required when creating a new vault.</span>
  <input
    class="prompt-input"
    type="password"
    placeholder="correct horse battery staple"
    bind:value={passphrase}
    on:input={clearError}
    on:keydown={handleEnter}
  />
</label>

<label class="obsidian-sync-form-row">
  <span class="obsidian-sync-form-label">Confirm passphrase</span>
  <span class="setting-item-description">Re-enter the passphrase to avoid creating the vault with a typo.</span>
  <input
    class="prompt-input"
    type="password"
    placeholder="correct horse battery staple"
    bind:value={confirmPassphrase}
    on:input={clearError}
    on:keydown={handleEnter}
  />
</label>

<div class="setting-item-description obsidian-sync-modal-error">{error}</div>

<div class="obsidian-sync-modal-actions">
  <button type="button" on:click={onCancel}>Cancel</button>
  <button type="button" class="mod-cta" on:click={submit}>Create vault</button>
</div>

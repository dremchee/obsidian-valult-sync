import { ApiError } from "../api";
import { shouldSyncPath } from "../sync/scope";

export interface StatusHeaderData {
  vaultId: string;
  serverUrl: string;
  trackedFilesCount: number;
  deletedFilesCount: number;
  lastSyncAt: number | null;
  lastSyncError: string;
  e2eeFingerprint: string | null;
  hasSessionPassphrase: boolean;
}

export function createSettingGroup(
  container: HTMLElement,
  title: string,
  _description: string,
): HTMLElement {
  const group = container.createDiv({ cls: "setting-group" });

  const heading = group.createDiv({ cls: "setting-item setting-item-heading" });
  heading.createDiv({ text: title, cls: "setting-item-name" });

  return group.createDiv({ cls: "setting-items" });
}

export function createPanel(container: HTMLElement): HTMLElement {
  const panel = container.createDiv({ cls: "setting-item obsidian-sync-panel" });
  if (container.childElementCount > 1) {
    panel.addClass("obsidian-sync-with-top-border");
  }
  return panel;
}

export function createCalloutPanel(
  container: HTMLElement,
  tone: "warn" | "error",
): HTMLElement {
  const panel = createPanel(container);
  panel.addClass(tone === "warn" ? "obsidian-sync-callout-warn" : "obsidian-sync-callout-error");
  return panel;
}

export function createCollapsibleSection(
  container: HTMLElement,
  title: string,
  summaryText: string,
  open: boolean,
): HTMLElement {
  const details = container.createEl("details", { cls: "setting-item obsidian-sync-collapsible" });
  details.open = open;
  if (container.childElementCount > 1) {
    details.addClass("obsidian-sync-with-top-border");
  }

  const summary = details.createEl("summary", { cls: "obsidian-sync-collapsible-summary" });
  summary.createSpan({ text: title });

  const help = details.createEl("div", {
    text: summaryText,
    cls: "setting-item-description obsidian-sync-collapsible-help",
  });

  return details;
}

export function createInlineStatus(container: HTMLElement, label: string, value: string): HTMLElement {
  const row = container.createDiv({ cls: "setting-item obsidian-sync-inline-status-row" });
  const statusEl = row.createDiv({
    text: `${label}: ${value}`,
    cls: "setting-item-description obsidian-sync-inline-status",
  });
  if (container.childElementCount > 1) {
    row.addClass("obsidian-sync-with-top-border");
  }
  return statusEl;
}

export function renderQuickActions(
  container: HTMLElement,
  actions: Array<{
    label: string;
    onClick: () => Promise<void>;
    cta?: boolean;
  }>,
): void {
  const row = container.createDiv({ cls: "setting-item obsidian-sync-quick-actions" });
  if (container.childElementCount > 1) {
    row.addClass("obsidian-sync-with-top-border");
  }

  for (const action of actions) {
    const button = row.createEl("button", { text: action.label });
    if (action.cta) {
      button.addClass("mod-cta");
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action.onClick();
      } finally {
        button.disabled = false;
      }
    });
  }
}

export function createKeyValueRow(container: HTMLElement, label: string, value: string): void {
  const row = container.createDiv({ cls: "obsidian-sync-key-value-row" });

  row.createSpan({ text: label, cls: "obsidian-sync-key-value-label" });

  row.createSpan({ text: value, cls: "obsidian-sync-key-value-value" });
}

export function renderStatusHeader(container: HTMLElement, status: StatusHeaderData): void {
  const panel = createPanel(container);
  const topRow = panel.createDiv({ cls: "obsidian-sync-status-header" });

  const copy = topRow.createDiv({ cls: "obsidian-sync-status-copy" });
  copy.createEl("div", { text: "Sync status", cls: "obsidian-sync-section-subtitle" });
  copy.createEl("div", {
    text: buildOverviewSummary(status),
    cls: "setting-item-description",
  });

  const badges = topRow.createDiv({ cls: "obsidian-sync-badges" });
  createBadge(
    badges,
    status.lastSyncError === "No recent errors" ? "Healthy" : "Needs attention",
    status.lastSyncError === "No recent errors" ? "ok" : "error",
  );
  createBadge(
    badges,
    status.e2eeFingerprint
      ? status.hasSessionPassphrase ? "E2EE loaded" : "E2EE locked"
      : status.hasSessionPassphrase ? "E2EE pending" : "E2EE off",
    status.e2eeFingerprint
      ? status.hasSessionPassphrase ? "ok" : "warn"
      : status.hasSessionPassphrase ? "warn" : "muted",
  );

  createKeyValueRow(panel, "Vault", status.vaultId);
  createKeyValueRow(panel, "Server", status.serverUrl || "Not configured");
  createKeyValueRow(panel, "Files tracked", String(status.trackedFilesCount));
  createKeyValueRow(panel, "Deletes tracked", String(status.deletedFilesCount));
  createKeyValueRow(panel, "Last sync", formatLastSyncAt(status.lastSyncAt));
  createKeyValueRow(panel, "Last issue", status.lastSyncError);
}

function createBadge(
  container: HTMLElement,
  text: string,
  tone: "ok" | "warn" | "error" | "muted",
): void {
  const badge = container.createSpan({ text, cls: "obsidian-sync-badge" });
  badge.addClass(`obsidian-sync-badge-${tone}`);
}

export function createStatusBadge(
  container: HTMLElement,
  text: string,
  tone: "ok" | "warn" | "error" | "muted",
): void {
  createBadge(container, text, tone);
}

function buildOverviewSummary(status: {
  trackedFilesCount: number;
  lastSyncAt: number | null;
  lastSyncError: string;
}): string {
  if (status.lastSyncError !== "No recent errors") {
    return `Attention required. ${status.lastSyncError}`;
  }

  return `Tracking ${status.trackedFilesCount} file(s). Last successful sync: ${formatLastSyncAt(status.lastSyncAt)}.`;
}

export function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function formatLastSyncAt(value: number | null): string {
  if (value === null) {
    return "Never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString();
}

export function buildE2eeStatusText(fingerprint: string | null, passphrase: string): string {
  if (!fingerprint) {
    return passphrase.trim()
      ? "E2EE: passphrase loaded. A fingerprint will be saved after the first encrypted sync."
      : "E2EE: off for this vault.";
  }

  if (!passphrase.trim()) {
    return `E2EE: fingerprint ${fingerprint.slice(0, 12)} is saved, but no passphrase is loaded in this session.`;
  }

  return `E2EE: fingerprint ${fingerprint.slice(0, 12)} is saved and the session passphrase is loaded.`;
}

export function formatDeviceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "auth failed";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function buildScopePreview(
  paths: string[],
  includePatterns: string[],
  ignorePatterns: string[],
): {
  syncedCount: number;
  skippedCount: number;
  sampleLines: string[];
} {
  const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
  let syncedCount = 0;
  let skippedCount = 0;

  const sampleLines = sortedPaths.slice(0, 12).map((path) => {
    const synced = shouldSyncPath(path, includePatterns, ignorePatterns);
    if (synced) {
      syncedCount += 1;
    } else {
      skippedCount += 1;
    }
    return `${synced ? "synced" : "skipped"}: ${path}`;
  });

  for (const path of sortedPaths.slice(12)) {
    if (shouldSyncPath(path, includePatterns, ignorePatterns)) {
      syncedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  if (sortedPaths.length === 0) {
    return {
      syncedCount: 0,
      skippedCount: 0,
      sampleLines: ["Vault is currently empty."],
    };
  }

  if (sortedPaths.length > 12) {
    sampleLines.push(`... and ${sortedPaths.length - 12} more path(s)`);
  }

  return {
    syncedCount,
    skippedCount,
    sampleLines,
  };
}

import { ApiError } from "./api";
import { shouldSyncPath } from "./sync-scope";

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

export function renderSectionHeader(container: HTMLElement, title: string, description: string): void {
  container.createEl("h3", { text: title });
  container.createEl("p", { text: description, cls: "setting-item-description" });
}

export function createPanel(container: HTMLElement): HTMLElement {
  const panel = container.createDiv();
  panel.style.border = "1px solid var(--background-modifier-border)";
  panel.style.borderRadius = "10px";
  panel.style.padding = "14px";
  panel.style.background = "var(--background-secondary)";
  panel.style.display = "grid";
  panel.style.gap = "10px";
  panel.style.marginBottom = "16px";
  return panel;
}

export function createCollapsibleSection(
  container: HTMLElement,
  title: string,
  summaryText: string,
  open: boolean,
): HTMLElement {
  const details = container.createEl("details");
  details.open = open;
  details.style.marginBottom = "16px";

  const summary = details.createEl("summary");
  summary.style.cursor = "pointer";
  summary.style.marginBottom = "10px";
  summary.style.fontWeight = "600";
  summary.createSpan({ text: title });

  const help = details.createEl("div", {
    text: summaryText,
    cls: "setting-item-description",
  });
  help.style.marginTop = "8px";
  help.style.marginBottom = "12px";

  return details;
}

export function createInlineStatus(container: HTMLElement, label: string, value: string): HTMLElement {
  const statusEl = container.createDiv({
    text: `${label}: ${value}`,
    cls: "setting-item-description",
  });
  statusEl.style.marginTop = "-8px";
  statusEl.style.marginBottom = "12px";
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
  const row = container.createDiv();
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.gap = "8px";
  row.style.marginTop = "-2px";
  row.style.marginBottom = "14px";

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
  const row = container.createDiv();
  row.style.display = "grid";
  row.style.gridTemplateColumns = "160px 1fr";
  row.style.gap = "12px";
  row.style.alignItems = "start";
  row.style.fontSize = "13px";

  const labelEl = row.createSpan({ text: label });
  labelEl.style.color = "var(--text-muted)";
  labelEl.style.fontWeight = "600";

  const valueEl = row.createSpan({ text: value });
  valueEl.style.wordBreak = "break-word";
}

export function renderStatusHeader(container: HTMLElement, status: StatusHeaderData): void {
  const panel = createPanel(container);
  const topRow = panel.createDiv();
  topRow.style.display = "flex";
  topRow.style.justifyContent = "space-between";
  topRow.style.alignItems = "flex-start";
  topRow.style.gap = "12px";
  topRow.style.flexWrap = "wrap";

  const copy = topRow.createDiv();
  copy.style.display = "grid";
  copy.style.gap = "6px";
  copy.style.flex = "1 1 280px";
  copy.createEl("div", { text: "Sync status", cls: "obsidian-sync-panel-title" });
  copy.createEl("div", {
    text: buildOverviewSummary(status),
    cls: "setting-item-description",
  });

  const badges = topRow.createDiv();
  badges.style.display = "flex";
  badges.style.gap = "8px";
  badges.style.flexWrap = "wrap";
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
  const badge = container.createSpan({ text });
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.padding = "4px 10px";
  badge.style.borderRadius = "999px";
  badge.style.fontSize = "12px";
  badge.style.fontWeight = "600";
  badge.style.border = "1px solid var(--background-modifier-border)";

  if (tone === "ok") {
    badge.style.background = "color-mix(in srgb, var(--background-secondary) 78%, var(--color-green) 22%)";
  } else if (tone === "warn") {
    badge.style.background = "color-mix(in srgb, var(--background-secondary) 78%, var(--color-orange) 22%)";
  } else if (tone === "error") {
    badge.style.background = "color-mix(in srgb, var(--background-secondary) 74%, var(--color-red) 26%)";
  } else {
    badge.style.background = "var(--background-primary-alt)";
  }
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

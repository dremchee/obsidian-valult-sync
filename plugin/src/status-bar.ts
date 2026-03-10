import { Menu, setIcon } from "obsidian";

export type StatusBarState = "ok" | "pending" | "syncing" | "error" | "disabled";

export interface StatusBarSnapshot {
  state: StatusBarState;
  statusText: string;
  lastSyncAt: number | null;
}

export class PluginStatusBar {
  private intervalId: number | null = null;

  constructor(
    private readonly statusBarEl: HTMLElement,
    private readonly getSnapshot: () => StatusBarSnapshot,
    private readonly onOpenSettings: () => void,
  ) {}

  start(): void {
    this.statusBarEl.addClass("mod-clickable");
    this.statusBarEl.addEventListener("click", this.handleClick);
    this.render();
    this.intervalId = window.setInterval(() => {
      this.render();
    }, 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.statusBarEl.removeEventListener("click", this.handleClick);
  }

  private readonly handleClick = (evt: MouseEvent): void => {
    const snapshot = this.getSnapshot();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(`Status: ${snapshot.statusText}`).setDisabled(true));
    menu.addItem((item) =>
      item
        .setTitle(`Last sync: ${formatLastSync(snapshot.lastSyncAt)}`)
        .setDisabled(true),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Open sync settings")
        .onClick(() => this.onOpenSettings()),
    );
    menu.showAtMouseEvent(evt);
  };

  private render(): void {
    const snapshot = this.getSnapshot();
    this.statusBarEl.empty();

    const iconEl = this.statusBarEl.createSpan({ cls: "obsidian-sync-status-icon" });
    setIcon(iconEl, iconForState(snapshot.state));

    this.statusBarEl.createSpan({
      text: snapshot.statusText,
      cls: "obsidian-sync-status-label",
    });
    this.statusBarEl.createSpan({
      text: formatLastSync(snapshot.lastSyncAt),
      cls: "obsidian-sync-status-time",
    });

    this.statusBarEl.title = `${snapshot.statusText}\nLast sync: ${formatLastSync(snapshot.lastSyncAt)}`;
    this.statusBarEl.style.display = "inline-flex";
    this.statusBarEl.style.alignItems = "center";
    this.statusBarEl.style.gap = "6px";
  }
}

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

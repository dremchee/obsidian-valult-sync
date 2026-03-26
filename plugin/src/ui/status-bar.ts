import { Menu } from "obsidian";

import StatusBarView from "./components/StatusBar.vue";
import { destroyComponent, mountComponent, type MountedVueComponent } from "./vue";

export type StatusBarState = "ok" | "pending" | "syncing" | "error" | "disabled";

export interface StatusBarSnapshot {
  state: StatusBarState;
  statusText: string;
  lastSyncAt: number | null;
  vaultId: string;
  lastError: string | null;
}

export class PluginStatusBar {
  private intervalId: number | null = null;
  private component: MountedVueComponent | null = null;

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
    void destroyComponent(this.component);
    this.component = null;
  }

  private readonly handleClick = (evt: MouseEvent): void => {
    const snapshot = this.getSnapshot();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(`Status: ${snapshot.statusText}`).setDisabled(true));
    menu.addItem((item) => item.setTitle(`Vault: ${snapshot.vaultId}`).setDisabled(true));
    menu.addItem((item) =>
      item
        .setTitle(`Last sync: ${formatLastSync(snapshot.lastSyncAt)}`)
        .setDisabled(true),
    );
    if (snapshot.lastError) {
      menu.addItem((item) => item.setTitle(`Last issue: ${snapshot.lastError}`).setDisabled(true));
    }
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
    this.statusBarEl.style.display = "inline-flex";
    this.statusBarEl.style.alignItems = "center";
    this.statusBarEl.style.gap = "6px";
    void destroyComponent(this.component);
    this.component = mountComponent(StatusBarView, this.statusBarEl, { snapshot });
  }
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

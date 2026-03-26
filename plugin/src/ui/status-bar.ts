import { Menu } from "obsidian";

import { t } from "../i18n";
import StatusBarView from "./components/StatusBar.vue";
import {
  destroyComponent,
  mountReactiveComponent,
  type MountedVueComponent,
  type ReactiveMountedVueComponent,
} from "./vue";

export type StatusBarState = "ok" | "pending" | "syncing" | "error" | "disabled";

export interface StatusBarSnapshot {
  state: StatusBarState;
  statusText: string;
  lastSyncAt: number | null;
  vaultId: string;
  lastError: string | null;
}

export class PluginStatusBar {
  private intervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  private component: ReactiveMountedVueComponent<{ snapshot: StatusBarSnapshot }> | null = null;

  constructor(
    private readonly statusBarEl: HTMLElement,
    private readonly getSnapshot: () => StatusBarSnapshot,
    private readonly onOpenSettings: () => void,
  ) {}

  start(): void {
    this.statusBarEl.addClass("mod-clickable");
    this.statusBarEl.addEventListener("click", this.handleClick);
    this.statusBarEl.style.display = "inline-flex";
    this.statusBarEl.style.alignItems = "center";
    this.statusBarEl.style.gap = "6px";
    this.component = mountReactiveComponent(StatusBarView, this.statusBarEl, {
      snapshot: this.getSnapshot(),
    });
    this.intervalId = globalThis.setInterval(() => {
      this.syncSnapshot();
    }, 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      globalThis.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.statusBarEl.removeEventListener("click", this.handleClick);
    void destroyComponent(this.component?.app ?? null);
    this.component = null;
  }

  private readonly handleClick = (evt: MouseEvent): void => {
    const snapshot = this.getSnapshot();
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle(t("statusBar.status", {
        status: snapshot.statusText,
      })).setDisabled(true));
    menu.addItem((item) =>
      item.setTitle(t("statusBar.vault", {
        vaultId: snapshot.vaultId,
      })).setDisabled(true));
    menu.addItem((item) =>
      item
        .setTitle(t("statusBar.lastSync", {
          time: formatLastSync(snapshot.lastSyncAt),
        }))
        .setDisabled(true),
    );
    if (snapshot.lastError) {
      menu.addItem((item) => item.setTitle(t("statusBar.lastIssue", {
        message: snapshot.lastError,
      })).setDisabled(true));
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("statusBar.openSettings"))
        .onClick(() => this.onOpenSettings()),
    );
    menu.showAtMouseEvent(evt);
  };

  private syncSnapshot(): void {
    if (!this.component) {
      return;
    }

    Object.assign(this.component.props.snapshot, this.getSnapshot());
  }
}

function formatLastSync(value: number | null): string {
  if (value === null) {
    return t("settings.common.never");
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

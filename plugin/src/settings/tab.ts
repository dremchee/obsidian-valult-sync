import { App, PluginSettingTab } from "obsidian";

import { SettingsController } from "./controller";
import { SettingsSession } from "./session";
import {
  mountReactiveComponent,
  type MountedVueComponent,
  type ReactiveMountedVueComponent,
} from "../ui/vue";
import SettingsTabView from "./components/SettingsTab.vue";
import type { SettingsActions, SettingsViewModel } from "./view-model";
import type ObsidianSyncPlugin from "../main";

export class SyncSettingTab extends PluginSettingTab {
  private component: ReactiveMountedVueComponent<{
    model: SettingsViewModel;
    actions: SettingsActions;
  }> | null = null;
  private readonly session: SettingsSession;

  constructor(
    app: App,
    private readonly plugin: ObsidianSyncPlugin,
    private readonly controller: SettingsController,
  ) {
    super(app, plugin);
    this.session = new SettingsSession(app, plugin, controller);
  }

  display(): void {
    this.session.sync();

    const { containerEl } = this;
    if (!this.component) {
      containerEl.empty();
      this.component = mountReactiveComponent(SettingsTabView, containerEl, {
        model: this.session.model,
        actions: this.session.actions,
      });
    }
  }
}

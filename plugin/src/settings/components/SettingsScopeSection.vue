<script setup lang="ts">
import type { SettingsActions, SettingsViewModel } from "../view-model";

const props = defineProps<{
  model: SettingsViewModel;
  actions: SettingsActions;
}>();

function handleIncludePatternsInput(event: Event): void {
  props.actions.onIncludePatternsChange((event.currentTarget as HTMLTextAreaElement).value);
}

function handleIgnorePatternsInput(event: Event): void {
  props.actions.onIgnorePatternsChange((event.currentTarget as HTMLTextAreaElement).value);
}
</script>

<template>
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
            :value="props.model.includePatterns.join('\n')"
            placeholder="Notes/\n*.md"
            rows="5"
            spellcheck="false"
            @input="handleIncludePatternsInput"
          />
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
            :value="props.model.ignorePatterns.join('\n')"
            placeholder=".obsidian/\nTemplates/\n*.canvas"
            rows="5"
            spellcheck="false"
            @input="handleIgnorePatternsInput"
          />
        </div>
      </div>
    </div>
  </div>
</template>

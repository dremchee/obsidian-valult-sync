<script setup lang="ts">
  import { t } from '@/i18n'
  import type {
    SettingsScopeActions,
    SettingsScopeViewModel
  } from '../view-model'

  const props = defineProps<{
    model: SettingsScopeViewModel
    actions: SettingsScopeActions
  }>()

  function handleIncludePatternsInput(event: Event): void {
    props.actions.onIncludePatternsChange(
      (event.currentTarget as HTMLTextAreaElement).value
    )
  }

  function handleIgnorePatternsInput(event: Event): void {
    props.actions.onIgnorePatternsChange(
      (event.currentTarget as HTMLTextAreaElement).value
    )
  }
</script>

<template>
  <div class="setting-group">
    <div class="setting-item setting-item-heading">
      <div class="setting-item-name">{{ t('settings.scope.heading') }}</div>
    </div>
    <div class="setting-items">
      <div class="setting-item">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.scope.include.label') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.scope.include.description') }}
          </div>
        </div>
        <div class="setting-item-control">
          <textarea
            :value="props.model.includePatterns.join('\n')"
            :placeholder="t('settings.scope.include.placeholder')"
            rows="5"
            spellcheck="false"
            @input="handleIncludePatternsInput"
          />
        </div>
      </div>

      <div class="setting-item obsidian-sync-with-top-border">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ t('settings.scope.ignore.label') }}
          </div>
          <div class="setting-item-description">
            {{ t('settings.scope.ignore.description') }}
          </div>
        </div>
        <div class="setting-item-control">
          <textarea
            :value="props.model.ignorePatterns.join('\n')"
            :placeholder="t('settings.scope.ignore.placeholder')"
            rows="5"
            spellcheck="false"
            @input="handleIgnorePatternsInput"
          />
        </div>
      </div>
    </div>
  </div>
</template>

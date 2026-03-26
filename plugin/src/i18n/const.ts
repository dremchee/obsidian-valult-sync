import en from "./locales/en.json";
import ru from "./locales/ru.json";

export const I18N_NAMESPACE = "obsidian-sync-plugin";
export const FALLBACK_LOCALE = "en";

export const I18N_RESOURCES = {
  en,
  ru,
} as const;

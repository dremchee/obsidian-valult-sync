import { I18N_NAMESPACE, I18N_RESOURCES, FALLBACK_LOCALE } from "./const";

type TranslationOptions = Record<string, unknown>;
type TranslationResource = Record<string, unknown>;

type I18nApi = {
  addResourceBundle?: (
    lng: string,
    ns: string,
    resources: object,
    deep?: boolean,
    overwrite?: boolean,
  ) => void;
  hasResourceBundle?: (lng: string, ns: string) => boolean;
  t: (key: string, options?: TranslationOptions) => string;
};

type I18nGlobal = {
  i18next?: I18nApi;
};

declare global {
  interface Window {
    i18next?: I18nApi;
  }
}

function getI18next(): I18nApi | undefined {
  return (globalThis as I18nGlobal).i18next;
}

export function registerPluginTranslations(): void {
  const i18n = getI18next();
  if (!i18n?.addResourceBundle) {
    return;
  }

  for (const [locale, resources] of Object.entries(I18N_RESOURCES)) {
    if (i18n.hasResourceBundle?.(locale, I18N_NAMESPACE)) {
      continue;
    }

    i18n.addResourceBundle(locale, I18N_NAMESPACE, resources, true, true);
  }
}

export function t(key: string, options?: TranslationOptions): string {
  const i18n = getI18next();
  const resolvedKey = `${I18N_NAMESPACE}:${key}`;
  if (i18n?.t) {
    const translated = i18n.t(resolvedKey, options);
    if (translated !== resolvedKey) {
      return translated;
    }

    const fallbackTranslated = i18n.t(resolvedKey, { ...options, lng: FALLBACK_LOCALE });
    if (fallbackTranslated !== resolvedKey) {
      return fallbackTranslated;
    }
  }

  return resolveFallbackTranslation(key, options);
}

function resolveFallbackTranslation(key: string, options?: TranslationOptions): string {
  const resource = getResourceValue(I18N_RESOURCES[FALLBACK_LOCALE], key);
  if (typeof resource !== "string") {
    return key;
  }

  return resource.replace(/\{\{\s*([.\w-]+)\s*\}\}/g, (_match, token: string) => {
    const replacement = options?.[token];
    return replacement === undefined || replacement === null ? "" : String(replacement);
  });
}

function getResourceValue(root: TranslationResource, key: string): string | TranslationResource | undefined {
  return key
    .split(".")
    .reduce<string | TranslationResource | undefined>((current, segment) => {
      if (typeof current !== "object" || current === null) {
        return undefined;
      }

      return current[segment] as string | TranslationResource | undefined;
    }, root);
}

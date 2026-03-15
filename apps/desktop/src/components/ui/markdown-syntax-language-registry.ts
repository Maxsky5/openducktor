type PrismLanguageLoader = () => Promise<{ default: unknown }>;

type CreateMarkdownSyntaxLanguageRegistryArgs = {
  languageAliases: Record<string, string>;
  defaultLanguages: Record<string, unknown>;
  lazyLanguageLoaders: Record<string, PrismLanguageLoader>;
  registerLanguage: (language: string, grammar: unknown) => void;
};

export function createMarkdownSyntaxLanguageRegistry({
  languageAliases,
  defaultLanguages,
  lazyLanguageLoaders,
  registerLanguage,
}: CreateMarkdownSyntaxLanguageRegistryArgs) {
  const registeredLanguages = new Set<string>();
  const pendingLanguageRegistrations = new Map<string, Promise<boolean>>();
  const supportedLanguages = new Set([
    ...Object.keys(defaultLanguages),
    ...Object.keys(lazyLanguageLoaders),
  ]);

  const normalizeLanguage = (language: string): string => {
    const normalized = language.trim().toLowerCase();
    return languageAliases[normalized] ?? normalized;
  };

  const registerNormalizedLanguage = (language: string, grammar: unknown): void => {
    if (registeredLanguages.has(language)) {
      return;
    }

    registerLanguage(language, grammar);
    registeredLanguages.add(language);
  };

  for (const [language, grammar] of Object.entries(defaultLanguages)) {
    registerNormalizedLanguage(language, grammar);
  }

  const isLanguageSupported = (language: string): boolean =>
    supportedLanguages.has(normalizeLanguage(language));

  const isLanguageRegistered = (language: string): boolean =>
    registeredLanguages.has(normalizeLanguage(language));

  const ensureLanguageRegistered = async (language: string): Promise<boolean> => {
    const normalizedLanguage = normalizeLanguage(language);

    if (!supportedLanguages.has(normalizedLanguage)) {
      return false;
    }

    if (registeredLanguages.has(normalizedLanguage)) {
      return true;
    }

    const existingRegistration = pendingLanguageRegistrations.get(normalizedLanguage);
    if (existingRegistration) {
      return existingRegistration;
    }

    const languageLoader = lazyLanguageLoaders[normalizedLanguage];
    if (!languageLoader) {
      return false;
    }

    const registration = languageLoader()
      .then((module) => {
        registerNormalizedLanguage(normalizedLanguage, module.default);
        return true;
      })
      .catch((error) => {
        console.error(`Failed to lazy-load language grammar for '${normalizedLanguage}':`, error);
        return false;
      })
      .finally(() => {
        pendingLanguageRegistrations.delete(normalizedLanguage);
      });

    pendingLanguageRegistrations.set(normalizedLanguage, registration);
    return registration;
  };

  return {
    ensureLanguageRegistered,
    isLanguageRegistered,
    isLanguageSupported,
    normalizeLanguage,
  };
}

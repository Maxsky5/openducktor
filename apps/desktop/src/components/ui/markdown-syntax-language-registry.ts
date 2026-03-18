type PrismLanguageLoader = () => Promise<{ default: unknown }>;
type LanguageRegistrationResult =
  | { status: "registered" }
  | { status: "unsupported" }
  | { status: "failed"; error: Error };

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
  const pendingLanguageRegistrations = new Map<string, Promise<LanguageRegistrationResult>>();
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

  const ensureLanguageRegistered = async (
    language: string,
  ): Promise<LanguageRegistrationResult> => {
    const normalizedLanguage = normalizeLanguage(language);

    if (!supportedLanguages.has(normalizedLanguage)) {
      return { status: "unsupported" };
    }

    if (registeredLanguages.has(normalizedLanguage)) {
      return { status: "registered" };
    }

    const existingRegistration = pendingLanguageRegistrations.get(normalizedLanguage);
    if (existingRegistration) {
      return existingRegistration;
    }

    const languageLoader = lazyLanguageLoaders[normalizedLanguage];
    if (!languageLoader) {
      return { status: "unsupported" };
    }

    const registration = languageLoader()
      .then((module) => {
        registerNormalizedLanguage(normalizedLanguage, module.default);
        return { status: "registered" } as const;
      })
      .catch((error) => {
        const failure =
          error instanceof Error
            ? error
            : new Error(String(error ?? "Unknown language loader error"));
        console.error(`Failed to lazy-load language grammar for '${normalizedLanguage}':`, failure);
        return { status: "failed", error: failure } as const;
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

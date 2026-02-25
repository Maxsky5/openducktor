import { describe, expect, mock, test } from "bun:test";
import { createMarkdownSyntaxLanguageRegistry } from "./markdown-syntax-language-registry";

describe("createMarkdownSyntaxLanguageRegistry", () => {
  test("normalizes aliases and registers default languages at initialization", () => {
    const registerLanguage = mock((_language: string, _grammar: unknown) => {});

    const registry = createMarkdownSyntaxLanguageRegistry({
      languageAliases: { js: "javascript" },
      defaultLanguages: {
        javascript: { name: "javascript" },
      },
      lazyLanguageLoaders: {},
      registerLanguage,
    });

    expect(registerLanguage).toHaveBeenCalledTimes(1);
    expect(registerLanguage.mock.calls[0]).toEqual(["javascript", { name: "javascript" }]);
    expect(registry.normalizeLanguage(" JS ")).toBe("javascript");
    expect(registry.isLanguageSupported("js")).toBe(true);
    expect(registry.isLanguageRegistered("js")).toBe(true);
  });

  test("loads and registers a lazy language once even with concurrent requests", async () => {
    const registerLanguage = mock((_language: string, _grammar: unknown) => {});
    const loadYamlLanguage = mock(async () => ({ default: { name: "yaml" } }));

    const registry = createMarkdownSyntaxLanguageRegistry({
      languageAliases: { yml: "yaml" },
      defaultLanguages: {},
      lazyLanguageLoaders: {
        yaml: loadYamlLanguage,
      },
      registerLanguage,
    });

    const [firstResult, secondResult] = await Promise.all([
      registry.ensureLanguageRegistered("yaml"),
      registry.ensureLanguageRegistered("yml"),
    ]);

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(loadYamlLanguage).toHaveBeenCalledTimes(1);
    expect(registerLanguage).toHaveBeenCalledTimes(1);
    expect(registerLanguage.mock.calls[0]).toEqual(["yaml", { name: "yaml" }]);

    const repeatedResult = await registry.ensureLanguageRegistered("yaml");
    expect(repeatedResult).toBe(true);
    expect(loadYamlLanguage).toHaveBeenCalledTimes(1);
  });

  test("returns false for unsupported languages and failed lazy loaders", async () => {
    const originalConsoleError = console.error;
    const consoleError = mock((_message: string, _error?: unknown) => {});
    const registerLanguage = mock((_language: string, _grammar: unknown) => {});
    const loadYamlLanguage = mock(async () => {
      throw new Error("bad grammar module");
    });

    console.error = consoleError as typeof console.error;
    try {
      const registry = createMarkdownSyntaxLanguageRegistry({
        languageAliases: {},
        defaultLanguages: {},
        lazyLanguageLoaders: {
          yaml: loadYamlLanguage,
        },
        registerLanguage,
      });

      const unsupportedResult = await registry.ensureLanguageRegistered("rust");
      const failedResult = await registry.ensureLanguageRegistered("yaml");

      expect(unsupportedResult).toBe(false);
      expect(failedResult).toBe(false);
      expect(loadYamlLanguage).toHaveBeenCalledTimes(1);
      expect(registerLanguage).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]?.[0]).toContain("yaml");
    } finally {
      console.error = originalConsoleError;
    }
  });
});

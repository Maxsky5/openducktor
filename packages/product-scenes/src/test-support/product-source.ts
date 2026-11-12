// The product source that the copied-* tests compare with the replicas. Each path starts at the
// root of the repository, such as `packages/contracts/src/index.ts`.

/** The URL of `repoPath` in the repository. */
function productUrl(repoPath: string): URL {
  return new URL(`../../../../${repoPath}`, import.meta.url);
}

/**
 * Imports a module of the product. The import is dynamic, so the type check of this package does
 * not check the product source. `Exports` names the exports that the test uses, and a missing
 * export fails the test.
 */
export async function importProduct<Exports>(repoPath: string): Promise<Exports> {
  // SAFETY: the caller names the exports of the module, and the test fails when one is missing.
  return (await import(productUrl(repoPath).href)) as Exports;
}

/** Reads a file of the product as text, for words that the product has only in its markup. */
export function readProduct(repoPath: string): Promise<string> {
  return Bun.file(productUrl(repoPath)).text();
}

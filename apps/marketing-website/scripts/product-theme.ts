// Read the same flat theme blocks used by the desktop renderer. Do not import its Tailwind runtime.
// The tokens apply only inside the product replicas, so the site keeps its own tokens.
export function productTheme(source: string): string {
  const light = source.match(/:root,\s*\.light\s*\{([^}]+)\}/)?.[1];
  const dark = source.match(/(?:^|\n)\.dark\s*\{([^}]+)\}/)?.[1];
  if (!light || !dark || !light.includes("--primary:") || !dark.includes("--primary:")) {
    throw new Error(
      "OpenDucktor theme blocks changed. Update the marketing theme extraction before building.",
    );
  }
  return `@layer product {\n.replica {${light}}\n:root[data-theme="dark"] .replica {${dark}}\n}\n`;
}

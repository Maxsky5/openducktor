// The light and the dark token blocks of tokens.css. The desktop app imports the file as it is. A
// consumer that applies the tokens to its own selector, such as the product scenes, reads the
// declarations of each block with this module.

/** The file that holds the theme tokens. */
export const TOKENS_FILE = new URL("./tokens.css", import.meta.url);

/** The declarations of the light and the dark themes, without their selectors. */
export type ThemeBlocks = { light: string; dark: string };

/** Reads the declarations of both theme blocks. It fails when a block moved or lost its tokens. */
export function readThemeBlocks(source: string): ThemeBlocks {
  const light = source.match(/:root,\s*\.light\s*\{([^}]+)\}/)?.[1];
  const dark = source.match(/(?:^|\n)\.dark\s*\{([^}]+)\}/)?.[1];
  if (!light || !dark || !light.includes("--primary:") || !dark.includes("--primary:")) {
    throw new Error(
      "The theme blocks of @openducktor/theme/tokens.css changed. Update readThemeBlocks before you build.",
    );
  }
  return { light, dark };
}

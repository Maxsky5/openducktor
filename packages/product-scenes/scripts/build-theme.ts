// Writes styles/theme.css from the desktop theme tokens. Run it after a change to
// @openducktor/theme/tokens.css. A test fails while the file does not match its source.
import { readFile, writeFile } from "node:fs/promises";
import { TOKENS_FILE } from "@openducktor/theme/blocks";
import { sceneTheme, THEME_FILE } from "./theme";

await writeFile(THEME_FILE, sceneTheme(await readFile(TOKENS_FILE, "utf8")));
console.log("Wrote styles/theme.css.");

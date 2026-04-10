import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveCargoTauriToolsRoot, resolveCefPath } from "./cef-paths";

const desktopRoot = process.cwd();
const tauriRoot = resolve(desktopRoot, "src-tauri");
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const cargoTauriPath = resolve(
  resolveCargoTauriToolsRoot(tauriRoot),
  "bin",
  `cargo-tauri${binaryExtension}`,
);
const cefPath = resolveCefPath(tauriRoot);

if (!existsSync(cargoTauriPath)) {
  throw new Error(`Missing cargo-tauri at ${cargoTauriPath}. Run tauri:setup:cef first.`);
}

if (!existsSync(cefPath)) {
  throw new Error(`Missing CEF bundle at ${cefPath}. Run tauri:setup:cef first.`);
}

console.log(`cargo_tauri_path=${cargoTauriPath}`);
console.log(`cef_path=${cefPath}`);

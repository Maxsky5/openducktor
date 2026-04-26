import { resolve } from "node:path";

import {
  CARGO_TAURI_CEF_TOOLCHAIN_PATCH,
  readCefVersion,
  readTauriCefRevision,
  resolveCargoTauriToolsRoot,
  resolveCefPath,
  resolveExportCefToolsRoot,
} from "./cef-paths";

const desktopRoot = process.cwd();
const tauriRoot = resolve(desktopRoot, "src-tauri");
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const tauriRevision = readTauriCefRevision(tauriRoot);
const cefVersion = readCefVersion(tauriRoot);
const cargoTauriRoot = resolveCargoTauriToolsRoot(tauriRoot);
const exportCefToolRoot = resolveExportCefToolsRoot(tauriRoot);

console.log(`tauri_revision=${tauriRevision}`);
console.log(`tauri_revision_short=${tauriRevision.slice(0, 12)}`);
console.log(`tauri_toolchain_patch=${CARGO_TAURI_CEF_TOOLCHAIN_PATCH}`);
console.log(`cef_version=${cefVersion}`);
console.log(`cargo_tauri_root=${cargoTauriRoot}`);
console.log(`cargo_tauri_path=${resolve(cargoTauriRoot, "bin", `cargo-tauri${binaryExtension}`)}`);
console.log(`export_cef_tool_root=${exportCefToolRoot}`);
console.log(
  `export_cef_dir_path=${resolve(exportCefToolRoot, "bin", `export-cef-dir${binaryExtension}`)}`,
);
console.log(`cef_path=${resolveCefPath(tauriRoot)}`);

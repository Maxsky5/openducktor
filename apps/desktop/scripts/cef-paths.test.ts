import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CARGO_TAURI_CEF_TOOLCHAIN_PATCH,
  readCefVersion,
  readTauriCefRevision,
  resolveCargoTauriToolsRoot,
  resolveCargoToolsRoot,
  resolveCefPath,
  resolveExportCefToolsRoot,
} from "./cef-paths";

const ENV_KEYS = [
  "CEF_PATH",
  "OPENDUCKTOR_CEF_PATH",
  "OPENDUCKTOR_CARGO_TOOLS_ROOT",
  "OPENDUCKTOR_CONFIG_DIR",
] as const;

const originalEnv = new Map<(typeof ENV_KEYS)[number], string | undefined>();

function withTempTauriRoot(lockContents: string): string {
  const root = mkdtempSync(join(tmpdir(), "odt-cef-paths-"));
  writeFileSync(join(root, "Cargo.lock"), lockContents);
  return root;
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const previousValue = originalEnv.get(key);
    if (previousValue === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = previousValue;
  }

  originalEnv.clear();
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
  }
});

afterEach(() => {
  restoreEnv();
});

describe("cef-paths", () => {
  test("reads the cef crate version from Cargo.lock", () => {
    const tauriRoot = withTempTauriRoot(
      '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "cef"\nversion = "135.0.0"\n\n[[package]]\nname = "tauri"\nversion = "2.10.3"\nsource = "git+https://github.com/tauri-apps/tauri?branch=feat%2Fcef#1234567890abcdef1234567890abcdef12345678"\n',
    );

    try {
      expect(readCefVersion(tauriRoot)).toBe("135.0.0");
    } finally {
      rmSync(tauriRoot, { force: true, recursive: true });
    }
  });

  test("uses the shared config root for default cache paths", () => {
    process.env.OPENDUCKTOR_CONFIG_DIR = "~/.openducktor-dev";
    const tauriRoot = withTempTauriRoot(
      '[[package]]\nname = "cef"\nversion = "136.2.1"\n\n[[package]]\nname = "tauri"\nversion = "2.10.3"\nsource = "git+https://github.com/tauri-apps/tauri?branch=feat%2Fcef#1234567890abcdef1234567890abcdef12345678"\n',
    );

    try {
      expect(resolveCargoToolsRoot(tauriRoot)).toBe(
        resolve(
          homedir(),
          ".openducktor-dev",
          "cache",
          "cargo-tools",
          "tauri-feat-cef",
          `1234567890ab-${CARGO_TAURI_CEF_TOOLCHAIN_PATCH}`,
        ),
      );
      expect(resolveCargoTauriToolsRoot(tauriRoot)).toBe(
        resolve(
          homedir(),
          ".openducktor-dev",
          "cache",
          "cargo-tools",
          "tauri-feat-cef",
          `1234567890ab-${CARGO_TAURI_CEF_TOOLCHAIN_PATCH}`,
        ),
      );
      expect(resolveExportCefToolsRoot(tauriRoot)).toBe(
        resolve(homedir(), ".openducktor-dev", "cache", "cargo-tools", "export-cef-dir", "136.2.1"),
      );
      expect(resolveCefPath(tauriRoot)).toBe(
        resolve(homedir(), ".openducktor-dev", "cache", "cef", "136.2.1"),
      );
    } finally {
      rmSync(tauriRoot, { force: true, recursive: true });
    }
  });

  test("prefers explicit OpenDucktor overrides", () => {
    process.env.CEF_PATH = "/tmp/upstream-cef";
    process.env.OPENDUCKTOR_CEF_PATH = "~/custom-cef";
    process.env.OPENDUCKTOR_CARGO_TOOLS_ROOT = "~/custom-tools";
    const tauriRoot = withTempTauriRoot(
      '[[package]]\nname = "cef"\nversion = "137.0.0"\n\n[[package]]\nname = "tauri"\nversion = "2.10.3"\nsource = "git+https://github.com/tauri-apps/tauri?branch=feat%2Fcef#abcdefabcdefabcdefabcdefabcdefabcdefabcd"\n',
    );

    try {
      expect(resolveCargoToolsRoot(tauriRoot)).toBe(resolve(homedir(), "custom-tools"));
      expect(resolveCargoTauriToolsRoot(tauriRoot)).toBe(resolve(homedir(), "custom-tools"));
      expect(resolveExportCefToolsRoot(tauriRoot)).toBe(resolve(homedir(), "custom-tools"));
      expect(resolveCefPath(tauriRoot)).toBe(resolve(homedir(), "custom-cef"));
    } finally {
      rmSync(tauriRoot, { force: true, recursive: true });
    }
  });

  test("reads the pinned tauri revision from Cargo.lock", () => {
    const tauriRoot = withTempTauriRoot(
      '[[package]]\nname = "cef"\nversion = "137.0.0"\n\n[[package]]\nname = "tauri"\nversion = "2.10.3"\nsource = "git+https://github.com/tauri-apps/tauri?branch=feat%2Fcef#abcdefabcdefabcdefabcdefabcdefabcdefabcd"\n',
    );

    try {
      expect(readTauriCefRevision(tauriRoot)).toBe("abcdefabcdefabcdefabcdefabcdefabcdefabcd");
    } finally {
      rmSync(tauriRoot, { force: true, recursive: true });
    }
  });

  test("prefers the git-sourced tauri package when multiple entries exist", () => {
    const tauriRoot = withTempTauriRoot(
      '[[package]]\nname = "cef"\nversion = "137.0.0"\n\n[[package]]\nname = "tauri"\nversion = "2.10.3"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "tauri"\nversion = "2.10.3"\nsource = "git+https://github.com/tauri-apps/tauri?branch=feat%2Fcef#fedcbafedcbafedcbafedcbafedcbafedcbafedc"\n',
    );

    try {
      expect(readTauriCefRevision(tauriRoot)).toBe("fedcbafedcbafedcbafedcbafedcbafedcbafedc");
    } finally {
      rmSync(tauriRoot, { force: true, recursive: true });
    }
  });

  test("rejects empty overrides", () => {
    process.env.OPENDUCKTOR_CARGO_TOOLS_ROOT = "   ";

    expect(() => resolveCargoToolsRoot(process.cwd())).toThrow(
      "OPENDUCKTOR_CARGO_TOOLS_ROOT is set but empty. Provide a valid directory path.",
    );
  });
});

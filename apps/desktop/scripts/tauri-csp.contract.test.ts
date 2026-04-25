import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type CspDirectiveSources = string[] | string;
type CspConfig = Record<string, CspDirectiveSources>;

type TauriConfig = {
  build?: {
    beforeBundleCommand?: string;
  };
  app?: {
    security?: {
      csp?: CspConfig | null;
      devCsp?: CspConfig | null;
    };
  };
};

const toSourceList = (value: CspDirectiveSources | undefined): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : value.split(/\s+/).filter((entry) => entry.length > 0);
};

const loadCspConfig = (): { csp: CspConfig; devCsp: CspConfig } => {
  const configPath = resolve(import.meta.dir, "../src-tauri/tauri.conf.json");
  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as TauriConfig;

  const csp = parsed.app?.security?.csp;
  const devCsp = parsed.app?.security?.devCsp;

  expect(csp).toBeObject();
  expect(devCsp).toBeObject();

  return {
    csp: csp as CspConfig,
    devCsp: devCsp as CspConfig,
  };
};

const loadTauriConfig = (): TauriConfig => {
  const configPath = resolve(import.meta.dir, "../src-tauri/tauri.conf.json");
  const raw = readFileSync(configPath, "utf8");
  return JSON.parse(raw) as TauriConfig;
};

describe("tauri CSP contract", () => {
  test("runs the CEF helper signing script from the desktop package root", () => {
    const config = loadTauriConfig();

    expect(config.build?.beforeBundleCommand).toBe("bun run scripts/sign-macos-cef-helper.ts");
  });

  test("keeps production CSP hardened and explicit", () => {
    const { csp } = loadCspConfig();

    expect(toSourceList(csp["default-src"])).toEqual(["'self'"]);
    expect(toSourceList(csp["base-uri"])).toEqual(["'none'"]);
    expect(toSourceList(csp["frame-ancestors"])).toEqual(["'none'"]);
    expect(toSourceList(csp["object-src"])).toEqual(["'none'"]);
    expect(toSourceList(csp["form-action"])).toEqual(["'self'"]);

    const scriptSrc = toSourceList(csp["script-src"]);
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    const connectSrc = toSourceList(csp["connect-src"]);
    expect(connectSrc).not.toContain("'self'");
    expect(connectSrc).toContain("ipc:");
    expect(connectSrc).toContain("http://ipc.localhost");
    expect(connectSrc).toContain("http://127.0.0.1:*");
    expect(connectSrc).not.toContain("ws://localhost:*");
    expect(connectSrc).not.toContain("ws://127.0.0.1:*");

    const imgSrc = toSourceList(csp["img-src"]);
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain("data:");
    expect(imgSrc).toContain("blob:");
    expect(imgSrc).toContain("asset:");
    expect(imgSrc).toContain("http://asset.localhost");

    const mediaSrc = toSourceList(csp["media-src"]);
    expect(mediaSrc).toContain("'self'");
    expect(mediaSrc).toContain("data:");
    expect(mediaSrc).toContain("blob:");
    expect(mediaSrc).toContain("asset:");
    expect(mediaSrc).toContain("http://asset.localhost");
  });

  test("keeps development CSP compatible with HMR while retaining baseline hardening", () => {
    const { devCsp } = loadCspConfig();

    expect(toSourceList(devCsp["default-src"])).toEqual(["'self'"]);
    expect(toSourceList(devCsp["base-uri"])).toEqual(["'none'"]);
    expect(toSourceList(devCsp["frame-ancestors"])).toEqual(["'none'"]);
    expect(toSourceList(devCsp["object-src"])).toEqual(["'none'"]);
    expect(toSourceList(devCsp["form-action"])).toEqual(["'self'"]);

    const scriptSrc = toSourceList(devCsp["script-src"]);
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'unsafe-inline'");

    const connectSrc = toSourceList(devCsp["connect-src"]);
    expect(connectSrc).toContain("ipc:");
    expect(connectSrc).toContain("http://ipc.localhost");
    expect(connectSrc).toContain("http://localhost:*");
    expect(connectSrc).toContain("ws://localhost:*");
    expect(connectSrc).toContain("http://127.0.0.1:*");
    expect(connectSrc).toContain("ws://127.0.0.1:*");

    const imgSrc = toSourceList(devCsp["img-src"]);
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain("data:");
    expect(imgSrc).toContain("blob:");
    expect(imgSrc).toContain("asset:");
    expect(imgSrc).toContain("http://asset.localhost");

    const mediaSrc = toSourceList(devCsp["media-src"]);
    expect(mediaSrc).toContain("'self'");
    expect(mediaSrc).toContain("data:");
    expect(mediaSrc).toContain("blob:");
    expect(mediaSrc).toContain("asset:");
    expect(mediaSrc).toContain("http://asset.localhost");
  });
});

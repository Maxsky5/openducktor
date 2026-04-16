import { expect, test } from "bun:test";
import {
  renderHomebrewCask,
  resolveAssetPattern,
  resolveHomebrewMacosRequirement,
} from "./release-homebrew-cask";

test("resolveAssetPattern creates an arch-aware Tauri DMG pattern", () => {
  expect(
    resolveAssetPattern("0.0.5", "OpenDucktor_0.0.5_aarch64.dmg", "OpenDucktor_0.0.5_x64.dmg"),
  ).toEqual({
    armArchToken: "aarch64",
    intelArchToken: "x64",
    assetPattern: "OpenDucktor_#{version}_#{arch}.dmg",
  });
});

test("resolveAssetPattern prefers x86_64 over x64 substring matches", () => {
  expect(
    resolveAssetPattern("0.0.5", "OpenDucktor_0.0.5_aarch64.dmg", "OpenDucktor_0.0.5_x86_64.dmg"),
  ).toEqual({
    armArchToken: "aarch64",
    intelArchToken: "x86_64",
    assetPattern: "OpenDucktor_#{version}_#{arch}.dmg",
  });
});

test("resolveAssetPattern preserves original asset token casing", () => {
  expect(
    resolveAssetPattern("0.0.5", "OpenDucktor_0.0.5_AARCH64.dmg", "OpenDucktor_0.0.5_X64.dmg"),
  ).toEqual({
    armArchToken: "AARCH64",
    intelArchToken: "X64",
    assetPattern: "OpenDucktor_#{version}_#{arch}.dmg",
  });
});

test("resolveAssetPattern replaces version before architecture tokens in prerelease names", () => {
  expect(
    resolveAssetPattern(
      "1.0.0-arm64",
      "OpenDucktor_1.0.0-arm64_arm64.dmg",
      "OpenDucktor_1.0.0-arm64_x64.dmg",
    ),
  ).toEqual({
    armArchToken: "arm64",
    intelArchToken: "x64",
    assetPattern: "OpenDucktor_#{version}_#{arch}.dmg",
  });
});

test("resolveAssetPattern rejects asset names without the version token", () => {
  expect(() =>
    resolveAssetPattern("0.0.5", "OpenDucktor_aarch64.dmg", "OpenDucktor_x64.dmg"),
  ).toThrow("Could not derive a `#{version}` placeholder");
});

test("resolveHomebrewMacosRequirement maps macOS 12 to monterey", () => {
  expect(resolveHomebrewMacosRequirement("12.0")).toBe(">= :monterey");
});

test("resolveHomebrewMacosRequirement rejects unsupported future macOS symbols", () => {
  expect(() => resolveHomebrewMacosRequirement("26.0")).toThrow(
    "Unsupported macOS minimum system version `26.0`",
  );
});

test("renderHomebrewCask renders the expected OpenDucktor cask", () => {
  const contents = renderHomebrewCask({
    version: "0.0.5",
    repository: "Maxsky5/openducktor",
    productName: "OpenDucktor",
    bundleIdentifier: "dev.openducktor.desktop",
    minimumSystemVersion: "12.0",
    armAssetName: "OpenDucktor_0.0.5_aarch64.dmg",
    armSha256: "a".repeat(64),
    intelAssetName: "OpenDucktor_0.0.5_x64.dmg",
    intelSha256: "b".repeat(64),
  });

  expect(contents).toContain('cask "openducktor" do');
  expect(contents).toContain('arch arm: "aarch64", intel: "x64"');
  expect(contents).toContain('version "0.0.5"');
  expect(contents).toContain(
    'url "https://github.com/Maxsky5/openducktor/releases/download/v#{version}/OpenDucktor_#{version}_#{arch}.dmg"',
  );
  expect(contents).toContain('depends_on macos: ">= :monterey"');
  expect(contents).toContain('app "OpenDucktor.app"');
  expect(contents).toContain('"~/.openducktor"');
  expect(contents).toContain('"~/Library/Preferences/dev.openducktor.desktop.plist"');
});

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

test("resolveHomebrewMacosRequirement maps macOS 12 to monterey", () => {
  expect(resolveHomebrewMacosRequirement("12.0")).toBe(">= :monterey");
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

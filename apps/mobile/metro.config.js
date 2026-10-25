// Expo finds the Bun workspace root and its isolated node_modules. The isolated pages ship as assets.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("html");

// A module runs when the app first uses one of its imports, not when the file that imports it
// loads. The first frame then runs only the modules that it needs, such as no Markdown or details
// modules for the Sessions list. Imports only for their effects, such as `install-globals` and the
// Unistyles setup, keep their place and order.
const expoTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const options = await expoTransformOptions(...args);
  return { ...options, transform: { ...options.transform, inlineRequires: true } };
};

// Package code that the app never runs on the device. Metro bundles each import, so these rules
// keep it out of the app bundle. The isolated pages, which do render math, build with Bun.
// - KaTeX: the math extension of micromark also exports an HTML compiler that the app does not use.
// - expo-symbols: only the native tabs of Expo Router use it, and the app has its own tab bar.
// - The Zod locales: Zod registers English by itself, and nothing reads `z.locales`.
const unusedImports = [
  { name: "katex", from: `${path.sep}micromark-extension-math${path.sep}` },
  { name: "expo-symbols", from: `${path.sep}expo-router${path.sep}` },
  { name: "../locales/index.js", from: `${path.sep}zod${path.sep}v4${path.sep}` },
];
const resolveExpoRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const unused = unusedImports.some(
    ({ name, from }) => moduleName === name && context.originModulePath.includes(from),
  );
  if (unused) return { type: "empty" };
  return (resolveExpoRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;

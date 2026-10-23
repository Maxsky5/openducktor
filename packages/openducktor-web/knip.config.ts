export default {
  entry: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  ignoreDependencies: [
    "@ff-labs/fff-node",
    // The host bundle externalizes MSAL's native persistence package.
    "@azure/msal-node-extensions",
    // The host bundle externalizes the native terminal package.
    "node-pty",
    // The host bundle externalizes the browser automation package.
    "playwright-core",
    // The artifact preview worker loads these external codecs at runtime.
    "sharp",
    "@resvg/resvg-wasm",
  ],
};

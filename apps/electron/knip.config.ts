export default {
  entry: [
    "src/**/*.test.{ts,tsx}",
    "src/main/{main,*-worker}.ts",
    "src/preload/preload.ts",
    "scripts/*.{ts,cjs}",
  ],
  ignoreDependencies: [
    // Required peer of app-builder-lib for Windows packaging.
    "electron-builder-squirrel-windows",
    // The Node bundle externalizes MSAL's native persistence package for the packaged app.
    "@azure/msal-node-extensions",
    // The Node bundle externalizes the host's native terminal package for the packaged app.
    "node-pty",
    // The Node bundle externalizes playwright-core, which the agent browser tools load at runtime.
    "playwright-core",
  ],
  project: ["src/**/*.{ts,tsx,css}", "scripts/**/*.ts"],
};

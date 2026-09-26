export default {
  entry: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  ignoreDependencies: [
    // Required peer of app-builder-lib for Windows packaging.
    "electron-builder-squirrel-windows",
    // Required by @vitejs/plugin-react optimizeDeps during cold Electron renderer startup.
    "react",
    "react-dom",
    // The Node bundle externalizes MSAL's native persistence package for the packaged app.
    "@azure/msal-node-extensions",
    // The Node bundle externalizes the host's native terminal package for the packaged app.
    "node-pty",
  ],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
};

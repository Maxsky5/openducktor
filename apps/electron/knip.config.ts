export default {
  entry: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  ignoreDependencies: [
    // Required peer of app-builder-lib for Windows packaging.
    "electron-builder-squirrel-windows",
    // Required by @vitejs/plugin-react optimizeDeps during cold Electron renderer startup.
    "react",
    "react-dom",
    // Loaded at runtime by the bundled host Claude file search.
    "@ff-labs/fff-node",
  ],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
};

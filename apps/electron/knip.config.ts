export default {
  entry: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  ignoreDependencies: [
    // Required by @vitejs/plugin-react optimizeDeps during cold Electron renderer startup.
    "react",
    "react-dom",
  ],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
};

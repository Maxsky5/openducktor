export default {
  workspaces: {
    "apps/electron": {
      ignoreDependencies: [
        // Required by @vitejs/plugin-react optimizeDeps during cold Electron renderer startup.
        "react",
        "react-dom",
      ],
    },
  },
};

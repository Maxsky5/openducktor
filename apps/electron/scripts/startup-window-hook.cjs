setImmediate(() => {
  const { app } = require("electron");
  if (!app) {
    throw new Error("Electron app API is unavailable in the startup test hook.");
  }
  app.once("browser-window-created", () => {
    process.stdout.write("ODT_ELECTRON_STARTUP_WINDOW_CREATED\n");
  });
});

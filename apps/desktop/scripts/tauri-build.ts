import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["run", "tauri", "build"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    OPENDUCKTOR_PREPARE_SIDECARS: "1",
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

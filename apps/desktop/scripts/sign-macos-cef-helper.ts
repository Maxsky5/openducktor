const platform = process.env.TAURI_ENV_PLATFORM ?? process.platform;

if (platform !== "darwin") {
  process.exit(0);
}

const signing = Bun.spawnSync(["bash", "scripts/sign-macos-cef-helper.sh"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(signing.exitCode ?? 1);

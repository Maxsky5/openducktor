import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createLoadTimeFixtureFolder,
  writeCheckedExecutable,
} from "../packages/host/src/test-support/checked-executable";

const script = resolve(import.meta.dir, "../install.sh");
const roots: string[] = [];
const unixTest = process.platform === "win32" ? test.skip : test;
const PROCESS_TIMEOUT_MS = 15_000;

function runInstallerTestCommand(command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    timeout: PROCESS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (result.error)
    throw new Error(`Could not run ${command} for the installer test.`, { cause: result.error });
  return result;
}

// The installer refuses to touch an OpenDucktor app that a machine already has, from
// /Applications or from Homebrew, so these cases run only on a Mac without one.
const homebrewManagesOpenDucktor = () =>
  ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].some((brew) => {
    if (!existsSync(brew)) return false;
    const result = runInstallerTestCommand(brew, ["list", "--cask", "--versions"]);
    if (result.status !== 0)
      throw new Error(`Homebrew could not list its installed apps. ${result.stderr}`);
    return result.stdout.split("\n").some((line) => line.startsWith("openducktor "));
  });
const macTest =
  process.platform === "darwin" &&
  !existsSync("/Applications/OpenDucktor.app") &&
  !homebrewManagesOpenDucktor()
    ? test
    : test.skip;

// The test commands keep separate inputs and reuse one macOS executable check.
const commandLauncher = join(
  await createLoadTimeFixtureFolder("openducktor-install-commands-"),
  "run",
);
await writeCheckedExecutable(commandLauncher, '#!/bin/sh\n. "$0.fixture"\n');

// Each case runs the installer as a child process. On a busy machine one run can take over five
// seconds, which is the default test timeout.
setDefaultTimeout(PROCESS_TIMEOUT_MS);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

macTest.each(["arm64", "x86_64"])("macOS %s installs the matching ZIP", (arch) => {
  const setup = fixture("Darwin", arch);
  expect(setup.run().status).toBe(0);
  expect(readFileSync(setup.installed, "utf8")).toBe("verified ZIP fixture\n");
  if (arch === "arm64") {
    const update = "updated ZIP fixture\n";
    writeFileSync(setup.assetPath, update);
    setup.asset.digest = `sha256:${createHash("sha256").update(update).digest("hex")}`;
    setup.saveRelease();
    expect(setup.run().status).toBe(0);
    expect(readFileSync(setup.installed, "utf8")).toBe(update);
  }
});

macTest("a failed Spotlight search stops the macOS install", () => {
  const setup = fixture("Darwin", "arm64");
  setup.stub("mdfind", "exit 7");
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Could not search for other OpenDucktor apps");
  expect(existsSync(setup.installed)).toBe(false);
});

unixTest("Linux installs and updates staged files with a special-character launcher path", () => {
  const setup = fixture("Linux", "x86_64", 'home %f $ \\ " `');
  setup.stub(
    "mv",
    'case "$2" in "$HOME/.local/bin/OpenDucktor.AppImage"|"$HOME/.local/share/applications/openducktor.desktop"|"$HOME/.local/share/icons/openducktor.png") case "$1" in "$HOME/.local/"*) ;; *) exit 8 ;; esac ;; esac\nexec /bin/mv "$@"',
  );
  expect(setup.run().status).toBe(0);
  expect(readFileSync(setup.installed, "utf8")).toContain("verified AppImage fixture");
  const desktop = readFileSync(
    join(setup.home, ".local/share/applications/openducktor.desktop"),
    "utf8",
  );
  const icon = join(setup.home, ".local/share/icons/openducktor.png");
  const exec = desktop.match(/^Exec="(.*)"$/m)?.[1];
  expect(exec).toEndWith("/.local/bin/OpenDucktor.AppImage");
  expect(exec).toContain("%%f");
  expect(exec).toContain("\\\\$");
  expect(exec).toContain("\\\\\\\\");
  expect(exec).toContain('\\\\"');
  expect(exec).toContain("\\\\`");
  expect(desktop).toContain(`Icon=${icon.replaceAll("\\", "\\\\")}`);
  expect(readFileSync(icon, "utf8")).toBe("icon for verified AppImage fixture\n");
  const update = linuxPayload("updated AppImage fixture");
  writeFileSync(setup.assetPath, update);
  setup.asset.digest = `sha256:${createHash("sha256").update(update).digest("hex")}`;
  setup.saveRelease();
  expect(setup.run().status).toBe(0);
  expect(readFileSync(setup.installed)).toEqual(update);
  expect(readFileSync(icon, "utf8")).toBe("icon for updated AppImage fixture\n");
});

unixTest("a changed download leaves the previous Linux install and launcher intact", () => {
  const setup = installedLinuxFixture();
  const desktopPath = join(setup.home, ".local/share/applications/openducktor.desktop");
  const previous = readFileSync(setup.installed);
  const previousDesktop = readFileSync(desktopPath);
  const iconPath = join(setup.home, ".local/share/icons/openducktor.png");
  const previousIcon = readFileSync(iconPath);
  writeFileSync(setup.assetPath, "wrong download");
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("SHA-256 differs");
  expect(readFileSync(setup.installed)).toEqual(previous);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
  expect(readFileSync(iconPath)).toEqual(previousIcon);
});

unixTest("a failed hash leaves the previous Linux install intact", () => {
  const setup = installedLinuxFixture();
  const previous = readFileSync(setup.installed);
  setup.stub("sha256sum", "exit 7");
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Could not hash the downloaded asset");
  expect(result.stderr).not.toContain("SHA-256 differs");
  expect(readFileSync(setup.installed)).toEqual(previous);
});

unixTest("a failed rollback removal keeps the old app and restores the launcher", () => {
  const setup = installedLinuxFixture();
  const previous = readFileSync(setup.installed);
  const desktopPath = join(setup.home, ".local/share/applications/openducktor.desktop");
  const iconPath = join(setup.home, ".local/share/icons/openducktor.png");
  const previousDesktop = readFileSync(desktopPath);
  const previousIcon = readFileSync(iconPath);
  const next = linuxPayload("updated AppImage fixture");
  writeFileSync(setup.assetPath, next);
  setup.asset.digest = `sha256:${createHash("sha256").update(next).digest("hex")}`;
  setup.saveRelease();
  setup.stub(
    "mv",
    'case "$1" in */.openducktor.desktop.stage.*) exit 7 ;; esac\nexec /bin/mv "$@"',
  );
  setup.stub(
    "rm",
    'case "$1:$2" in -rf:"$HOME/.local/bin/OpenDucktor.AppImage") exit 7 ;; esac\nexec /bin/rm "$@"',
  );
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Could not remove");
  const backup = readdirSync(join(setup.home, ".local/bin")).find((name) =>
    name.startsWith(".OpenDucktor.AppImage.backup."),
  );
  expect(backup).toBeDefined();
  expect(readFileSync(join(setup.home, ".local/bin", backup!))).toEqual(previous);
  expect(readFileSync(setup.installed)).toEqual(next);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
  expect(readFileSync(iconPath)).toEqual(previousIcon);
});

unixTest("a failed launcher install restores the previous Linux app and launcher", () => {
  const setup = installedLinuxFixture();
  const desktopPath = join(setup.home, ".local/share/applications/openducktor.desktop");
  const previous = readFileSync(setup.installed);
  const previousDesktop = readFileSync(desktopPath);
  const iconPath = join(setup.home, ".local/share/icons/openducktor.png");
  const previousIcon = readFileSync(iconPath);
  setup.stub(
    "mv",
    'case "$1" in */.openducktor.desktop.stage.*) exit 7 ;; esac\nexec /bin/mv "$@"',
  );
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Could not install the desktop launcher");
  expect(readFileSync(setup.installed)).toEqual(previous);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
  expect(readFileSync(iconPath)).toEqual(previousIcon);
});

unixTest("a failed backup cleanup keeps the new Linux app and launcher", () => {
  const setup = installedLinuxFixture();
  const next = linuxPayload("new AppImage fixture");
  writeFileSync(setup.assetPath, next);
  setup.asset.digest = `sha256:${createHash("sha256").update(next).digest("hex")}`;
  setup.saveRelease();
  setup.stub(
    "rm",
    'case "$1:$2" in -f:*/.openducktor.desktop.backup.*) exit 7 ;; esac\nexec /bin/rm "$@"',
  );
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("old launcher backup");
  expect(readFileSync(setup.installed)).toEqual(next);
  expect(readFileSync(join(setup.home, ".local/share/icons/openducktor.png"), "utf8")).toBe(
    "icon for new AppImage fixture\n",
  );
  expect(existsSync(join(setup.home, ".local/share/applications/openducktor.desktop"))).toBe(true);
  expect(
    existsSync(join(setup.home, ".local/share/applications/.openducktor-script-install")),
  ).toBe(true);
});

unixTest("a terminal hangup restores the previous Linux app", () => {
  const setup = installedLinuxFixture();
  const previous = readFileSync(setup.installed);
  const desktopPath = join(setup.home, ".local/share/applications/openducktor.desktop");
  const previousDesktop = readFileSync(desktopPath);
  const iconPath = join(setup.home, ".local/share/icons/openducktor.png");
  const previousIcon = readFileSync(iconPath);
  setup.stub(
    "mv",
    'case "$2" in */.OpenDucktor.AppImage.backup.*) /bin/mv "$@" || exit; kill -HUP "$(ps -o ppid= -p "$$" | tr -d "[:space:]")"; exit 0 ;; esac\nexec /bin/mv "$@"',
  );
  const result = setup.run();
  expect(result.status).toBe(129);
  expect(readFileSync(setup.installed)).toEqual(previous);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
  expect(readFileSync(iconPath)).toEqual(previousIcon);
});

unixTest("Linux rejects an AppImage without an icon before changing the installed app", () => {
  const setup = installedLinuxFixture();
  const previous = readFileSync(setup.installed);
  const iconPath = join(setup.home, ".local/share/icons/openducktor.png");
  const previousIcon = readFileSync(iconPath);
  const noIcon = Buffer.from("#!/bin/sh\nexit 0\n");
  writeFileSync(setup.assetPath, noIcon);
  setup.asset.digest = `sha256:${createHash("sha256").update(noIcon).digest("hex")}`;
  setup.saveRelease();
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("AppImage has no icon");
  expect(readFileSync(setup.installed)).toEqual(previous);
  expect(readFileSync(iconPath)).toEqual(previousIcon);
});

unixTest("missing or ambiguous assets and missing digests fail before installation", () => {
  const setup = fixture("Linux", "x86_64");
  for (const assets of [[], [setup.asset, setup.asset], [{ ...setup.asset, digest: null }]]) {
    setup.release.assets = assets;
    setup.saveRelease();
    const result = setup.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("matching desktop asset");
  }
});

unixTest("an unmanaged install and an unsupported processor fail without changes", () => {
  const setup = fixture("Linux", "x86_64");
  mkdirSync(join(setup.home, ".local/bin"), { recursive: true });
  writeFileSync(setup.installed, "other installer");
  expect(setup.run().stderr).toContain("unmanaged install");
  expect(readFileSync(setup.installed, "utf8")).toBe("other installer");
  expect(setup.run({ ODT_TEST_ARCH: "aarch64" }).stderr).toContain("Unsupported system");
});

unixTest("a missing process check stops installation", () => {
  const setup = fixture("Linux", "x86_64");
  symlinkSync("/bin/sh", join(setup.bin, "sh"));
  setup.stub("sha256sum", "exit 7");
  rmSync(join(setup.bin, "pgrep"));
  const result = setup.run({ PATH: setup.bin });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("pgrep is required");
  expect(existsSync(setup.installed)).toBe(false);
});

unixTest("a running Linux app blocks an update without changing the installed file", () => {
  const setup = installedLinuxFixture();
  const previous = readFileSync(setup.installed);
  const result = setup.run({ ODT_TEST_RUNNING: "0" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Quit OpenDucktor");
  expect(readFileSync(setup.installed)).toEqual(previous);
});

unixTest("a failed process check leaves the Linux app intact", () => {
  const setup = installedLinuxFixture("home[");
  const previous = readFileSync(setup.installed);
  const patternPath = join(setup.home, "pgrep-pattern");
  setup.stub("pgrep", 'printf "%s\\n" "$2" > "$ODT_TEST_PGREP_PATTERN"\nexit 2');
  const result = setup.run({ ODT_TEST_PGREP_PATTERN: patternPath });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Could not check if OpenDucktor is running");
  expect(readFileSync(setup.installed)).toEqual(previous);
  expect(readFileSync(patternPath, "utf8")).toContain("\\[");
});

type ReleaseFixture = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{
    name: string;
    state: string;
    digest: string | null;
    browser_download_url: string;
  }>;
};

function fixture(os: "Darwin" | "Linux", arch: string, homeName = "home") {
  const root = mkdtempSync(join(tmpdir(), "openducktor-install-test-"));
  roots.push(root);
  const bin = join(root, "bin");
  const home = join(root, homeName);
  mkdirSync(bin);
  mkdirSync(home);
  const payload =
    os === "Linux"
      ? linuxPayload("verified AppImage fixture")
      : Buffer.from("verified ZIP fixture\n");
  const digest = createHash("sha256").update(payload).digest("hex");
  let target: string;
  if (os === "Linux") {
    target = "linux-x86_64.AppImage";
  } else if (arch === "arm64") {
    target = "mac-arm64.zip";
  } else {
    target = "mac-x64.zip";
  }
  const name = `OpenDucktor-0.8.0-${target}`;
  const url = `https://github.com/Maxsky5/openducktor/releases/download/v0.8.0/${name}`;
  const releasePath = join(root, "release.json");
  const assetPath = join(root, "asset");
  writeFileSync(assetPath, payload);
  const asset = { name, state: "uploaded", digest: `sha256:${digest}`, browser_download_url: url };
  const release: ReleaseFixture = {
    tag_name: "v0.8.0",
    draft: false,
    prerelease: false,
    assets: [asset],
  };
  const saveRelease = () => writeFileSync(releasePath, JSON.stringify(release));
  saveRelease();
  const stub = (name: string, body: string) => {
    const command = join(bin, name);
    writeFileSync(`${command}.fixture`, `${body}\n`);
    if (!existsSync(command)) linkSync(commandLauncher, command);
  };
  stub(
    "uname",
    'if [ "$1" = -s ]; then printf "%s\\n" "$ODT_TEST_OS"; else printf "%s\\n" "$ODT_TEST_ARCH"; fi',
  );
  stub(
    "curl",
    [
      "for arg do",
      '  case "$arg" in',
      "    https://api.github.com/*) source=$ODT_TEST_RELEASE ;;",
      "    https://github.com/*) source=$ODT_TEST_ASSET ;;",
      "  esac",
      "done",
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = -o ]; then',
      "    output=$2",
      "    break",
      "  fi",
      "  shift",
      "done",
      '[ -n "${source:-}" ] && [ -n "${output:-}" ] || exit 2',
      'cp "$source" "$output"',
    ].join("\n"),
  );
  stub("pgrep", 'exit "${ODT_TEST_RUNNING:-1}"');
  if (os === "Darwin") {
    stub("mdfind", "exit 0");
    stub("ditto", 'mkdir -p "$4/OpenDucktor.app" && cp "$3" "$4/OpenDucktor.app/contents"');
    stub("codesign", "exit 0");
    stub("spctl", "exit 0");
  } else if (process.platform === "darwin" && !Bun.which("sha256sum")) {
    // Older macOS releases have shasum but no native sha256sum for the Linux installer.
    stub("sha256sum", 'exec shasum -a 256 "$@"');
  }
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`,
    ODT_TEST_OS: os,
    ODT_TEST_ARCH: arch,
    ODT_TEST_RELEASE: releasePath,
    ODT_TEST_ASSET: assetPath,
  };
  const run = (extra: Record<string, string> = {}) =>
    runInstallerTestCommand("sh", [script], { ...env, ...extra });
  const installed =
    os === "Linux"
      ? join(home, ".local/bin/OpenDucktor.AppImage")
      : join(home, "Applications/OpenDucktor.app/contents");
  return { asset, assetPath, bin, home, installed, release, run, saveRelease, stub };
}

function linuxPayload(name: string) {
  return Buffer.from(
    `#!/bin/sh\nif [ "$1" = --appimage-extract ]; then\n  mkdir -p squashfs-root\n  printf 'icon for ${name}\\n' > squashfs-root/.DirIcon\n  exit 0\nfi\n# ${name}\n`,
  );
}

function installedLinuxFixture(homeName?: string) {
  const setup = fixture("Linux", "x86_64", homeName);
  const applications = join(setup.home, ".local/share/applications");
  const icons = join(setup.home, ".local/share/icons");
  mkdirSync(join(setup.home, ".local/bin"), { recursive: true });
  mkdirSync(applications, { recursive: true });
  mkdirSync(icons, { recursive: true });
  writeFileSync(setup.installed, linuxPayload("previous AppImage"), { mode: 0o755 });
  writeFileSync(join(applications, "openducktor.desktop"), "previous launcher\n");
  writeFileSync(join(applications, ".openducktor-script-install"), "Installed by install.sh\n");
  writeFileSync(join(icons, "openducktor.png"), "previous icon\n");
  return setup;
}

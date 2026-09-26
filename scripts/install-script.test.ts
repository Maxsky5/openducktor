import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../install.sh");
const roots: string[] = [];
const unixTest = process.platform === "win32" ? test.skip : test;
const macTest =
  process.platform === "darwin" && !existsSync("/Applications/OpenDucktor.app") ? test : test.skip;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

macTest.each(["arm64", "x86_64"])("macOS %s installs and updates the matching ZIP", (arch) => {
  const setup = fixture("Darwin", arch);
  expect(setup.run().status).toBe(0);
  expect(readFileSync(setup.installed, "utf8")).toBe("installed app\n");
  expect(setup.run().status).toBe(0);
  expect(readFileSync(setup.installed, "utf8")).toBe("installed app\n");
});

unixTest("Linux installs and updates one AppImage with a desktop launcher", () => {
  const setup = fixture("Linux", "x86_64");
  expect(setup.run().status).toBe(0);
  expect(readFileSync(setup.installed, "utf8")).toContain("verified AppImage fixture");
  const desktop = readFileSync(
    join(setup.home, ".local/share/applications/openducktor.desktop"),
    "utf8",
  );
  const icon = join(setup.home, ".local/share/icons/openducktor.png");
  expect(desktop).toContain(`Exec="${setup.installed}"`);
  expect(desktop).toContain(`Icon=${icon}`);
  expect(readFileSync(icon, "utf8")).toBe("icon for verified AppImage fixture\n");
  expect(setup.run().status).toBe(0);
  expect(readFileSync(icon, "utf8")).toBe("icon for verified AppImage fixture\n");
});

unixTest("Linux stages the app and launcher beside their install paths", () => {
  const setup = fixture("Linux", "x86_64");
  writeFileSync(
    join(setup.bin, "mv"),
    '#!/bin/sh\ncase "$2" in "$HOME/.local/bin/OpenDucktor.AppImage"|"$HOME/.local/share/applications/openducktor.desktop"|"$HOME/.local/share/icons/openducktor.png") case "$1" in "$HOME/.local/"*) ;; *) exit 8 ;; esac ;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  expect(setup.run().status).toBe(0);
  expect(readFileSync(setup.installed, "utf8")).toContain("verified AppImage");
});

unixTest("Linux escapes special characters in a desktop launcher path", () => {
  const setup = fixture("Linux", "x86_64", 'home %f $ \\ " `');
  expect(setup.run().status).toBe(0);
  const desktop = readFileSync(
    join(setup.home, ".local/share/applications/openducktor.desktop"),
    "utf8",
  );
  const exec = desktop.match(/^Exec="(.*)"$/m)?.[1];
  expect(exec).toBeDefined();
  expect(exec).toContain("%%f");
  expect(exec).toContain("\\\\$");
  expect(exec).toContain("\\\\\\\\");
  expect(exec).toContain('\\\\"');
  expect(exec).toContain("\\\\`");
  expect(desktop).toContain(
    `Icon=${setup.home.replaceAll("\\", "\\\\")}/.local/share/icons/openducktor.png`,
  );
});

unixTest("a changed download leaves the previous Linux install and launcher intact", () => {
  const setup = fixture("Linux", "x86_64");
  expect(setup.run().status).toBe(0);
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

unixTest("a failed launcher install restores the previous Linux app and launcher", () => {
  const setup = fixture("Linux", "x86_64");
  expect(setup.run().status).toBe(0);
  const desktopPath = join(setup.home, ".local/share/applications/openducktor.desktop");
  const previous = readFileSync(setup.installed);
  const previousDesktop = readFileSync(desktopPath);
  const iconPath = join(setup.home, ".local/share/icons/openducktor.png");
  const previousIcon = readFileSync(iconPath);
  writeFileSync(
    join(setup.bin, "mv"),
    '#!/bin/sh\ncase "$1" in */.openducktor.desktop.stage.*) exit 7 ;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  const result = setup.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Could not install the desktop launcher");
  expect(readFileSync(setup.installed)).toEqual(previous);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
  expect(readFileSync(iconPath)).toEqual(previousIcon);
});

unixTest("a failed backup cleanup keeps the new Linux app and launcher", () => {
  const setup = fixture("Linux", "x86_64");
  expect(setup.run().status).toBe(0);
  const next = linuxPayload("new AppImage fixture");
  writeFileSync(setup.assetPath, next);
  setup.asset.digest = `sha256:${createHash("sha256").update(next).digest("hex")}`;
  setup.saveRelease();
  writeFileSync(
    join(setup.bin, "rm"),
    '#!/bin/sh\ncase "$1:$2" in -f:*/.openducktor.desktop.backup.*) exit 7 ;; esac\nexec /bin/rm "$@"\n',
    { mode: 0o755 },
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
  const setup = fixture("Linux", "x86_64");
  expect(setup.run().status).toBe(0);
  const previous = readFileSync(setup.installed);
  const desktopPath = join(setup.home, ".local/share/applications/openducktor.desktop");
  const previousDesktop = readFileSync(desktopPath);
  const iconPath = join(setup.home, ".local/share/icons/openducktor.png");
  const previousIcon = readFileSync(iconPath);
  writeFileSync(
    join(setup.bin, "mv"),
    '#!/bin/sh\ncase "$2" in */.OpenDucktor.AppImage.backup.*) /bin/mv "$@" || exit; kill -HUP "$(ps -o ppid= -p "$$" | tr -d "[:space:]")"; exit 0 ;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  const result = setup.run();
  expect(result.status).toBe(129);
  expect(readFileSync(setup.installed)).toEqual(previous);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
  expect(readFileSync(iconPath)).toEqual(previousIcon);
});

unixTest("Linux rejects an AppImage without an icon before changing the installed app", () => {
  const setup = fixture("Linux", "x86_64");
  expect(setup.run().status).toBe(0);
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

unixTest("the README and guide report a failed shell script download", () => {
  const root = mkdtempSync(join(tmpdir(), "openducktor-install-command-"));
  roots.push(root);
  writeFileSync(join(root, "curl"), "#!/bin/sh\nexit 22\n", { mode: 0o755 });
  for (const path of [
    resolve(import.meta.dir, "../README.md"),
    resolve(import.meta.dir, "../docs/installation.md"),
  ]) {
    const command = readFileSync(path, "utf8").match(/^bash -o pipefail -c 'curl[^\n]+'$/m)?.[0];
    expect(command).toBeDefined();
    const result = spawnSync("sh", ["-c", command!], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
    });
    expect(result.status).toBe(22);
  }
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
  rmSync(join(setup.bin, "pgrep"));
  const result = setup.run({ PATH: setup.bin });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("pgrep is required");
  expect(existsSync(setup.installed)).toBe(false);
});

unixTest("a running Linux app blocks an update without changing the installed file", () => {
  const setup = fixture("Linux", "x86_64");
  expect(setup.run().status).toBe(0);
  const previous = readFileSync(setup.installed);
  const result = setup.run({ ODT_TEST_RUNNING: "0" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Quit OpenDucktor");
  expect(readFileSync(setup.installed)).toEqual(previous);
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
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
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
  stub("mdfind", "exit 0");
  stub(
    "sha256sum",
    [
      "python3 - \"$1\" <<'PY'",
      "import hashlib,sys",
      "p=sys.argv[1]",
      'print(hashlib.sha256(open(p,"rb").read()).hexdigest(),p)',
      "PY",
    ].join("\n"),
  );
  stub(
    "ditto",
    'mkdir -p "$4/OpenDucktor.app"; printf "installed app\\n" > "$4/OpenDucktor.app/contents"',
  );
  stub("codesign", "exit 0");
  stub("spctl", "exit 0");
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
    spawnSync("sh", [script], { encoding: "utf8", env: { ...env, ...extra } });
  const installed =
    os === "Linux"
      ? join(home, ".local/bin/OpenDucktor.AppImage")
      : join(home, "Applications/OpenDucktor.app/contents");
  return { asset, assetPath, bin, home, installed, release, run, saveRelease };
}

function linuxPayload(name: string) {
  return Buffer.from(
    `#!/bin/sh\nif [ "$1" = --appimage-extract ]; then\n  mkdir -p squashfs-root\n  printf 'icon for ${name}\\n' > squashfs-root/.DirIcon\n  exit 0\nfi\n# ${name}\n`,
  );
}

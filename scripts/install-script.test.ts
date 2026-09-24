import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../install.sh");
const roots: string[] = [];
const unixTest = process.platform === "win32" ? test.skip : test;
const macTest =
  process.platform === "darwin" && !existsSync("/Applications/OpenDucktor.app") ? test : test.skip;

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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(os: "Darwin" | "Linux", arch: string) {
  const root = mkdtempSync(join(tmpdir(), "openducktor-install-test-"));
  roots.push(root);
  const bin = join(root, "bin");
  const home = join(root, "home");
  mkdirSync(bin);
  mkdirSync(home);
  const payload = Buffer.from("verified AppImage or ZIP fixture\n");
  const digest = createHash("sha256").update(payload).digest("hex");
  const target =
    os === "Linux" ? "linux-x86_64.AppImage" : `mac-${arch === "arm64" ? "arm64" : "x64"}.zip`;
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
  const executable = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };
  executable(
    "uname",
    'if [ "$1" = -s ]; then printf "%s\\n" "$ODT_TEST_OS"; else printf "%s\\n" "$ODT_TEST_ARCH"; fi',
  );
  executable(
    "curl",
    'for arg do case "$arg" in https://api.github.com/*) source=$ODT_TEST_RELEASE ;; https://github.com/*) source=$ODT_TEST_ASSET ;; esac; previous=$arg; done; while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then output=$2; break; fi; shift; done; [ -n "${source:-}" ] && [ -n "${output:-}" ] || exit 2; cp "$source" "$output"',
  );
  executable("pgrep", 'exit "${ODT_TEST_RUNNING:-1}"');
  executable(
    "sha256sum",
    'python3 - "$1" <<\'PY\'\nimport hashlib,sys\np=sys.argv[1]\nprint(hashlib.sha256(open(p,"rb").read()).hexdigest(),p)\nPY',
  );
  executable(
    "ditto",
    'mkdir -p "$4/OpenDucktor.app"; printf "installed app\\n" > "$4/OpenDucktor.app/contents"',
  );
  executable("codesign", "exit 0");
  executable("spctl", "exit 0");
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
  return { asset, assetPath, bin, digest, home, installed, release, run, saveRelease };
}

macTest.each(["arm64", "x86_64"])("macOS %s installs and updates the matching ZIP", (arch) => {
  const f = fixture("Darwin", arch);
  expect(f.run().status).toBe(0);
  expect(readFileSync(f.installed, "utf8")).toBe("installed app\n");
  expect(f.run().status).toBe(0);
  expect(readFileSync(f.installed, "utf8")).toBe("installed app\n");
});

unixTest("Linux installs and updates one AppImage with a desktop launcher", () => {
  const f = fixture("Linux", "x86_64");
  expect(f.run().status).toBe(0);
  expect(readFileSync(f.installed, "utf8")).toBe("verified AppImage or ZIP fixture\n");
  const desktop = readFileSync(
    join(f.home, ".local/share/applications/openducktor.desktop"),
    "utf8",
  );
  expect(desktop).toContain(`Exec="${f.installed}"`);
  expect(f.run().status).toBe(0);
});

unixTest("a changed download leaves the previous Linux install and launcher intact", () => {
  const f = fixture("Linux", "x86_64");
  expect(f.run().status).toBe(0);
  const desktopPath = join(f.home, ".local/share/applications/openducktor.desktop");
  const previous = readFileSync(f.installed);
  const previousDesktop = readFileSync(desktopPath);
  writeFileSync(f.assetPath, "wrong download");
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("SHA-256 differs");
  expect(readFileSync(f.installed)).toEqual(previous);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
});

unixTest("a failed launcher install restores the previous Linux app and launcher", () => {
  const f = fixture("Linux", "x86_64");
  expect(f.run().status).toBe(0);
  const desktopPath = join(f.home, ".local/share/applications/openducktor.desktop");
  const previous = readFileSync(f.installed);
  const previousDesktop = readFileSync(desktopPath);
  writeFileSync(
    join(f.bin, "mv"),
    '#!/bin/sh\ncase "$1" in */openducktor-install.*/openducktor.desktop) exit 7 ;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Could not install the desktop launcher");
  expect(readFileSync(f.installed)).toEqual(previous);
  expect(readFileSync(desktopPath)).toEqual(previousDesktop);
});

unixTest("missing or ambiguous assets and missing digests fail before installation", () => {
  const f = fixture("Linux", "x86_64");
  for (const assets of [[], [f.asset, f.asset], [{ ...f.asset, digest: null }]]) {
    f.release.assets = assets;
    f.saveRelease();
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("matching desktop asset");
  }
});

unixTest("an unmanaged install and an unsupported processor fail without changes", () => {
  const f = fixture("Linux", "x86_64");
  mkdirSync(join(f.home, ".local/bin"), { recursive: true });
  writeFileSync(f.installed, "other installer");
  expect(f.run().stderr).toContain("unmanaged install");
  expect(readFileSync(f.installed, "utf8")).toBe("other installer");
  expect(f.run({ ODT_TEST_ARCH: "aarch64" }).stderr).toContain("Unsupported system");
});

unixTest("a running Linux app blocks an update without changing the installed file", () => {
  const f = fixture("Linux", "x86_64");
  expect(f.run().status).toBe(0);
  const previous = readFileSync(f.installed);
  const result = f.run({ ODT_TEST_RUNNING: "0" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Quit OpenDucktor");
  expect(readFileSync(f.installed)).toEqual(previous);
});

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { BrowserEngineEvent, BrowserEnginePort } from "../../../ports/browser-engine-port";
import { makeChromeForTestingBrowserEngine } from "./chrome-for-testing-engine";
import {
  type ChromeForTestingInstallation,
  ChromeForTestingInstallError,
} from "./chrome-for-testing-installer";
import {
  CHROME_FOR_TESTING_ARCHIVES,
  CHROME_FOR_TESTING_SUPPORTED_PLATFORMS,
  CHROME_FOR_TESTING_VERSION,
} from "./chrome-for-testing-pin";
import { ChromeLaunchError, type ChromeLauncher } from "./chrome-process";
import { createFakeChrome, type FakeChrome, settle } from "./test-support/fake-chrome";

const TAB_ID = "22222222-2222-4222-8222-222222222222";
const ARCHIVE = CHROME_FOR_TESTING_ARCHIVES[0];

const fakeInstallation = (
  options: {
    installed?: () => boolean;
    install?: ChromeForTestingInstallation["install"];
  } = {},
): ChromeForTestingInstallation & { installs: () => number } => {
  let installs = 0;
  return {
    archive: ARCHIVE,
    executable: "/browser/chrome",
    isInstalled: Effect.sync(() => options.installed?.() ?? false),
    install: (report) =>
      Effect.suspend(() => {
        installs += 1;
        return options.install?.(report) ?? Effect.void;
      }),
    installs: () => installs,
  };
};

const makeEngine = async (
  options: {
    installation?: ChromeForTestingInstallation | null;
    launch?: ChromeLauncher;
  } = {},
) => {
  const configRoot = await mkdtemp(path.join(tmpdir(), "odt-cft-engine-"));
  const chromes: FakeChrome[] = [];
  const launch: ChromeLauncher =
    options.launch ??
    (() =>
      Effect.sync(() => {
        const fake = createFakeChrome();
        chromes.push(fake);
        return fake.chrome;
      }));
  const engine = await Effect.runPromise(
    makeChromeForTestingBrowserEngine({
      configRoot,
      platform: "linux",
      hostPlatformName: "linux-x64",
      installation:
        options.installation === undefined
          ? fakeInstallation({ installed: () => true })
          : options.installation,
      launch,
    }),
  );
  const events: BrowserEngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  const states = () =>
    events.flatMap((event) => (event.type === "state_changed" ? [event.state.kind] : []));
  return { engine, events, states, chromes, configRoot };
};

const failureOf = async <A>(
  effect: Effect.Effect<A, { readonly code: string; readonly message: string }>,
) => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (result._tag !== "Failure") throw new Error("Expected a failure.");
  return result.failure;
};

const createTab = (engine: BrowserEnginePort, tabId = TAB_ID, url = "http://localhost:3000/") =>
  engine.createTab({ tabId, workspaceId: "acme", url });

describe("makeChromeForTestingBrowserEngine", () => {
  test("a host without a pinned build reports the supported platforms", async () => {
    const { engine } = await makeEngine({ installation: null });

    expect(engine.state()).toEqual({
      kind: "unsupported_platform",
      platform: "linux-x64",
      supported: [...CHROME_FOR_TESTING_SUPPORTED_PLATFORMS],
    });
    expect((await failureOf(engine.installer?.start() ?? Effect.void)).code).toBe("unsupported");
    expect((await failureOf(createTab(engine))).code).toBe("unsupported");
  });

  test("starts the download only when asked, then reports progress and ready", async () => {
    const installation = fakeInstallation({
      install: (report) =>
        Effect.sync(() => {
          report({
            kind: "downloading",
            version: CHROME_FOR_TESTING_VERSION,
            receivedBytes: 10,
            totalBytes: ARCHIVE.sizeBytes,
          });
          report({ kind: "verifying", version: CHROME_FOR_TESTING_VERSION });
        }),
    });
    const { engine, states } = await makeEngine({ installation });

    expect(engine.state()).toEqual({
      kind: "not_installed",
      version: CHROME_FOR_TESTING_VERSION,
      downloadBytes: ARCHIVE.sizeBytes,
    });
    expect(installation.installs()).toBe(0);
    const notReady = await failureOf(createTab(engine));
    expect(notReady.code).toBe("not_ready");
    expect(notReady.message).toContain("The next agent browser tool installs it");

    await Effect.runPromise(engine.installer?.start() ?? Effect.void);
    await settle();

    expect(states()).toEqual(["downloading", "verifying", "ready"]);
    expect(engine.state()).toEqual({
      kind: "ready",
      engine: "chrome_for_testing",
    });
  });

  test("a second start while a download runs does not start another download", async () => {
    const installation = fakeInstallation({ install: () => Effect.never });
    const { engine } = await makeEngine({ installation });

    await Effect.runPromise(engine.installer?.start() ?? Effect.void);
    await Effect.runPromise(engine.installer?.start() ?? Effect.void);

    expect(installation.installs()).toBe(1);
    await Effect.runPromise(engine.dispose());
  });

  test("cancel stops the download and returns to not_installed", async () => {
    const { engine, states } = await makeEngine({
      installation: fakeInstallation({
        install: (report) =>
          Effect.sync(() =>
            report({
              kind: "downloading",
              version: CHROME_FOR_TESTING_VERSION,
              receivedBytes: 0,
              totalBytes: ARCHIVE.sizeBytes,
            }),
          ).pipe(Effect.andThen(Effect.never)),
      }),
    });

    await Effect.runPromise(engine.installer?.start() ?? Effect.void);
    await settle();
    await Effect.runPromise(engine.installer?.cancel() ?? Effect.void);

    expect(states()).toEqual(["downloading", "not_installed"]);
    expect(engine.state().kind).toBe("not_installed");
  });

  test("a failed download reports the reason and allows a new download", async () => {
    const installation = fakeInstallation({
      install: () =>
        Effect.fail(new ChromeForTestingInstallError({ message: "The checksum differs." })),
    });
    const { engine } = await makeEngine({ installation });

    await Effect.runPromise(engine.installer?.start() ?? Effect.void);
    await settle();

    expect(engine.state()).toEqual({
      kind: "failed",
      reason: "The checksum differs.",
      missingLibraries: [],
      canRetryDownload: true,
    });
    await Effect.runPromise(engine.installer?.start() ?? Effect.void);
    await settle();
    expect(installation.installs()).toBe(2);
  });

  test("a Chrome start failure reports the missing libraries, and retry starts Chrome again", async () => {
    let launches = 0;
    const installation = fakeInstallation({ installed: () => true });
    const { engine } = await makeEngine({
      installation,
      launch: () =>
        Effect.suspend(() => {
          launches += 1;
          return Effect.fail(
            new ChromeLaunchError({
              message: "Chrome for Testing cannot start because libnss3.so is missing.",
              missingLibraries: ["libnss3.so"],
            }),
          );
        }),
    });

    const failure = await failureOf(createTab(engine));

    expect(failure.code).toBe("not_ready");
    expect(engine.state()).toEqual({
      kind: "failed",
      reason: "Chrome for Testing cannot start because libnss3.so is missing.",
      missingLibraries: ["libnss3.so"],
      canRetryDownload: false,
    });
    await Effect.runPromise(engine.installer?.start() ?? Effect.void);
    expect(engine.state().kind).toBe("ready");
    expect(installation.installs()).toBe(0);
    await failureOf(createTab(engine));
    expect(launches).toBe(2);
  });

  test("runs one Chrome process for each workspace with tabs and stops it after the last tab", async () => {
    const { engine, chromes, configRoot } = await makeEngine();

    await Effect.runPromise(createTab(engine));
    await Effect.runPromise(createTab(engine, "33333333-3333-4333-8333-333333333333"));
    expect(chromes).toHaveLength(1);
    expect(
      await stat(path.join(configRoot, "browser", "workspaces", "acme", "profile")),
    ).toBeTruthy();

    await Effect.runPromise(engine.closeTab(TAB_ID));
    expect(chromes[0]?.isStopped()).toBe(false);
    await Effect.runPromise(engine.closeTab("33333333-3333-4333-8333-333333333333"));
    expect(chromes[0]?.isStopped()).toBe(true);

    await Effect.runPromise(createTab(engine));
    expect(chromes).toHaveLength(2);
    await Effect.runPromise(engine.dispose());
    expect(chromes[1]?.isStopped()).toBe(true);
  });

  test("refuses other schemes, bad workspace IDs, and tab IDs that already exist", async () => {
    const { engine } = await makeEngine();

    expect((await failureOf(createTab(engine, TAB_ID, "file:///etc/hosts"))).message).toContain(
      "only http and https",
    );
    expect(
      (
        await failureOf(
          engine.createTab({ tabId: TAB_ID, workspaceId: "../x", url: "about:blank" }),
        )
      ).message,
    ).toContain("is not valid");
    await Effect.runPromise(createTab(engine));
    expect((await failureOf(createTab(engine))).message).toContain("already exists");
    expect((await failureOf(engine.closeTab("44444444-4444-4444-8444-444444444444"))).code).toBe(
      "tab_not_found",
    );
  });

  test("deleteWorkspaceProfile stops the workspace process and deletes its profile", async () => {
    const { engine, chromes, configRoot } = await makeEngine();
    await Effect.runPromise(createTab(engine));
    const profile = path.join(configRoot, "browser", "workspaces", "acme", "profile");
    await mkdir(path.join(profile, "Default"), { recursive: true });

    await Effect.runPromise(engine.deleteWorkspaceProfile("acme"));

    expect(chromes[0]?.isStopped()).toBe(true);
    await expect(stat(profile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

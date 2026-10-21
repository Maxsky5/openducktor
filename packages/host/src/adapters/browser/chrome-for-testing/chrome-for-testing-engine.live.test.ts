import { afterAll, beforeAll, describe, test } from "bun:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { BrowserEngineState } from "@openducktor/contracts";
import { Effect } from "effect";
import type { BrowserEnginePort } from "../../../ports/browser-engine-port";
import { BROWSER_ENGINE_CONFORMANCE_CHECKS } from "../../../testing/browser-engine-conformance";
import {
  type BrowserConformanceInput,
  type BrowserConformancePages,
  startBrowserConformancePages,
} from "../../../testing/browser-engine-conformance-support";
import { createChromeForTestingBrowserEngine } from "./chrome-for-testing-engine";

/**
 * Runs only when `ODT_CHROME_FOR_TESTING_CONFIG_ROOT` names a config root. `bun run
 * test:browser-conformance` in `packages/host` sets it to a cache folder. When the folder has no
 * pinned Chrome for Testing, the run installs it with the real installer.
 */
const configRoot = process.env.ODT_CHROME_FOR_TESTING_CONFIG_ROOT;

// The first run downloads about 200 MB.
const INSTALL_TIMEOUT_MS = 10 * 60_000;

/** Installs the pinned Chrome for Testing when the engine is not ready. */
const installChromeForTesting = async (engine: BrowserEnginePort): Promise<void> => {
  if (engine.state().kind === "ready") return;
  console.log(`Installing Chrome for Testing into ${configRoot}.`);
  let unsubscribe = () => {};
  const settled = new Promise<BrowserEngineState>((resolve) => {
    unsubscribe = engine.subscribe((event) => {
      if (event.type !== "state_changed") return;
      if (event.state.kind !== "downloading" && event.state.kind !== "verifying") {
        resolve(event.state);
      }
    });
  });
  try {
    await Effect.runPromise(engine.installer?.start() ?? Effect.void);
    const final = await settled;
    if (final.kind !== "ready") {
      throw new Error(`Chrome for Testing did not install: ${JSON.stringify(final)}`);
    }
  } finally {
    unsubscribe();
  }
};

describe.skipIf(configRoot === undefined)("Chrome for Testing engine conformance", () => {
  let engine: BrowserEnginePort;
  let pages: BrowserConformancePages;
  let input: BrowserConformanceInput;
  const workspaceId = `conformance-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    engine = await Effect.runPromise(
      createChromeForTestingBrowserEngine({
        configRoot: path.resolve(configRoot ?? ""),
        platform: process.platform,
        arch: process.arch,
      }),
    );
    await installChromeForTesting(engine);
    pages = await startBrowserConformancePages();
    input = { engine, pages, workspaceId };
  }, INSTALL_TIMEOUT_MS);

  afterAll(async () => {
    await Effect.runPromise(Effect.ignore(engine.deleteWorkspaceProfile(workspaceId)));
    await Effect.runPromise(engine.dispose());
    await pages.close();
  });

  for (const [name, verify] of BROWSER_ENGINE_CONFORMANCE_CHECKS) {
    test(name, () => verify(input));
  }
});

import { describe, expect, test } from "bun:test";
import type { BrowserPrompt } from "@openducktor/contracts";
import { Deferred, Effect, Exit } from "effect";
import type {
  BrowserAutomationPage,
  BrowserAutomationPort,
} from "../../ports/browser-automation-port";
import type { CdpPayload, CdpSession } from "../../ports/browser-engine-port";
import { createBrowserAgentPages } from "./browser-agent-pages";
import { createBrowserPagePrompts } from "./browser-page-prompts";
import { createBrowserPromptBook } from "./browser-prompt-book";
import { createBrowserTabRegistry } from "./browser-tab-registry";
import {
  createBrowserServiceHarness,
  tabId,
  tabSummary,
  taskOwner,
} from "./test-support/browser-service-harness";

/** A CDP session that answers each command from `answer`, or with an empty result. */
const fakeSession = (
  answer: (method: string) => Promise<CdpPayload> | null = () => null,
): CdpSession => {
  const request = (method: string) => answer(method) ?? Promise.resolve({});
  return {
    sessionId: "S1",
    targetId: "T1",
    request: (method) => request(method),
    send: (method) => Effect.promise(() => request(method)),
    subscribe: () => () => {},
    onDetached: () => () => {},
    ownsSession: () => true,
  };
};

const unused = () => Effect.die(new Error("The test does not use this page call."));

/** A page whose calls the test does not use, and that counts its closes. */
const fakePage = () => {
  let closes = 0;
  const page: BrowserAutomationPage = {
    snapshot: unused,
    elementPoint: unused,
    click: unused,
    hover: unused,
    fill: unused,
    press: unused,
    selectOptions: unused,
    scrollIntoView: unused,
    scrollBy: unused,
    screenshot: unused,
    waitFor: unused,
    close: () =>
      Effect.sync(() => {
        closes += 1;
      }),
  };
  return { page, closes: () => closes };
};

describe("browser agent actions", () => {
  test("a release lets the running action finish, stops the queued action, then closes the client", async () => {
    const { page, closes } = fakePage();
    const automation: BrowserAutomationPort = { connect: () => Effect.succeed(page) };
    const pages = createBrowserAgentPages({
      engine: {
        openSession: () => Effect.succeed(fakeSession()),
        holdWake: () => Effect.void,
        reloadPage: () => Effect.void,
        captureScreenshot: () => Effect.succeed({}),
      },
      automation,
      registry: { get: () => undefined, update: () => {}, subscribe: () => () => {} },
      runJob: (job) => void Effect.runFork(job),
      onPressing: () => {},
    });
    const started = Deferred.makeUnsafe<void>();
    const running = Deferred.makeUnsafe<void>();

    const first = Effect.runPromise(
      Effect.result(
        pages.act(tabId(1), Effect.void, () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(running)),
            Effect.as("first"),
          ),
        ),
      ),
    );
    await Effect.runPromise(Deferred.await(started));
    const second = Effect.runPromise(
      Effect.result(pages.act(tabId(1), Effect.void, () => Effect.succeed("second"))),
    );
    const released = Effect.runPromise(pages.release(tabId(1)));

    const stopped = await second;
    expect(stopped._tag === "Failure" ? stopped.failure.code : null).toBe("browser_not_shared");
    expect(closes()).toBe(0);
    Deferred.doneUnsafe(running, Exit.void);
    const finished = await first;
    expect(finished._tag === "Success" ? finished.success : null).toEqual({
      kind: "done",
      value: "first",
    });
    await released;
    expect(closes()).toBe(1);
  });

  test("a file chooser prompt opens when its event comes, then gets the accepted file types", async () => {
    const registry = createBrowserTabRegistry(() => {});
    registry.add(tabSummary({ shared: true }));
    const resolveNode = Promise.withResolvers<CdpPayload>();
    const jobs: Promise<void>[] = [];
    const pagePrompts = createBrowserPagePrompts({
      tabId: tabId(1),
      session: fakeSession((method) => {
        if (method === "DOM.resolveNode") return resolveNode.promise;
        if (method === "Runtime.callFunctionOn") {
          return Promise.resolve({ result: { type: "string", value: "image/png, .jpg" } });
        }
        return null;
      }),
      prompts: createBrowserPromptBook(registry, () => "prompt-1"),
      isAgentActing: () => true,
      runJob: (job) => void jobs.push(Effect.runPromise(job)),
    });

    pagePrompts.handleEvent({
      method: "Page.fileChooserOpened",
      params: { frameId: "T1", mode: "selectSingle", backendNodeId: 4 },
      sessionId: "S1",
    });

    const opened: BrowserPrompt = {
      promptId: "prompt-1",
      kind: "file_chooser",
      multiple: false,
      accept: [],
      startedByAgent: true,
    };
    expect(registry.get(tabId(1))?.summary.prompts).toEqual([opened]);
    resolveNode.resolve({ object: { type: "object", objectId: "input-1" } });
    await Promise.all(jobs);
    expect(registry.get(tabId(1))?.summary.prompts).toEqual([
      { ...opened, accept: ["image/png", ".jpg"] },
    ]);
  });

  test("an agent navigation marks agent activity while it runs", async () => {
    const harness = createBrowserServiceHarness();
    await Effect.runPromise(
      harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }),
    );
    await Effect.runPromise(harness.service.setShared({ tabId: tabId(1), shared: true }));
    harness.events.length = 0;

    // The test engine has no pages, so only the activity mark of the call matters here.
    await Effect.runPromise(
      Effect.result(
        harness.service.runAgentTool(taskOwner, "odt_browser_navigate", {
          tabId: tabId(1),
          url: "http://localhost:3000/next",
        }),
      ),
    );

    expect(
      harness.events.flatMap((event) =>
        event.type === "tab_upserted" ? [event.tab.agentActive] : [],
      ),
    ).toEqual([true, false]);
  });
});

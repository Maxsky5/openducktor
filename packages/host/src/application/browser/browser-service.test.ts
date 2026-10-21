import { describe, expect, test } from "bun:test";
import { BROWSER_TAB_LIMIT } from "@openducktor/contracts";
import { Deferred, Effect, Exit } from "effect";
import { BrowserEngineError } from "../../ports/browser-engine-port";
import {
  createBrowserServiceHarness,
  waitUntil,
  sessionOwner,
  tabId,
  taskOwner,
} from "./test-support/browser-service-harness";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

const upserted = (events: ReturnType<typeof createBrowserServiceHarness>["events"]) =>
  events.flatMap((event) => (event.type === "tab_upserted" ? [event.tab] : []));

describe("browser service tabs", () => {
  test("opens a user tab and turns a local address into an http URL", async () => {
    const { service, engine, events } = createBrowserServiceHarness();

    const tab = await run(
      service.openTab({
        owner: taskOwner,
        tabId: tabId(1),
        address: "localhost:5173/app",
      }),
    );

    expect(tab).toMatchObject({
      tabId: tabId(1),
      createdBy: "user",
      shared: false,
      live: false,
      url: "http://localhost:5173/app",
      owner: taskOwner,
    });
    expect(engine.created).toEqual([tabId(1)]);
    expect(upserted(events).map((summary) => summary.tabId)).toEqual([tabId(1)]);
  });

  test("opens a frame tab with no page and no installed browser, and saves the frame state", async () => {
    const { service, engine, tabFile } = createBrowserServiceHarness({
      engine: {
        showsPagesToUser: false,
        state: () => ({ kind: "not_installed", version: "1", downloadBytes: 10 }),
      },
    });

    const tab = await run(
      service.openTab({
        owner: taskOwner,
        tabId: tabId(1),
        address: "localhost:5173",
      }),
    );
    await run(
      service.reportFrameState({
        tabId: tabId(1),
        url: "http://localhost:5173/settings",
        title: "Settings",
        favicon: null,
        loading: false,
        canGoBack: true,
        canGoForward: false,
        error: null,
      }),
    );

    expect(tab).toMatchObject({ started: false, live: false, url: "http://localhost:5173/" });
    expect(engine.created).toEqual([]);
    expect((await run(service.listTabs()))[0]).toMatchObject({
      url: "http://localhost:5173/settings",
      title: "Settings",
      canGoBack: true,
    });
    await waitUntil(() => tabFile.current.tabs[0]?.url === "http://localhost:5173/settings");
    expect(tabFile.current.tabs[0]?.title).toBe("Settings");
  });

  test("a frame page cannot start a host page or be shared with agents", async () => {
    const { service, engine } = createBrowserServiceHarness({
      engine: { showsPagesToUser: false },
    });
    const tab = await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));

    const started = await failure(service.startTab(tabId(1)));
    const shared = await failure(service.setShared({ tabId: tabId(1), shared: true }));

    expect(tab).toMatchObject({ page: "frame", started: false, shared: false });
    expect(started.message).toBe(
      "This tab shows its page in a frame of the app, so it has no page to start.",
    );
    expect(shared.message).toBe(
      "This tab shows its page in a frame of the app, which agents cannot reach.",
    );
    expect(engine.created).toEqual([]);
  });

  test("a tab with a host page refuses frame state", async () => {
    const { service } = createBrowserServiceHarness();
    await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));

    const error = await failure(
      service.reportFrameState({
        tabId: tabId(1),
        url: "http://localhost:5173/",
        title: null,
        favicon: null,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
      }),
    );

    expect(error).toMatchObject({ code: "browser_invalid_input" });
    expect((await run(service.listTabs()))[0]?.url).toBe("about:blank");
  });

  test("opens a blank tab when the address is empty", async () => {
    const { service } = createBrowserServiceHarness();

    const tab = await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));

    expect(tab.url).toBe("about:blank");
  });

  test("refuses other schemes and text that is not an address", async () => {
    const { service, engine } = createBrowserServiceHarness();

    const scheme = await failure(
      service.openTab({
        owner: taskOwner,
        tabId: tabId(1),
        address: "file:///etc/passwd",
      }),
    );
    const text = await failure(
      service.openTab({
        owner: taskOwner,
        tabId: tabId(2),
        address: "what is react",
      }),
    );

    expect(scheme).toMatchObject({ code: "browser_scheme_refused" });
    expect(scheme.message).toContain("file");
    expect(text).toMatchObject({ code: "browser_invalid_address" });
    expect(engine.created).toEqual([]);
  });

  test("fails with an install message while the browser is not installed", async () => {
    const { service, engine } = createBrowserServiceHarness({
      engine: { state: () => ({ kind: "not_installed", version: "1", downloadBytes: 10 }) },
    });

    const error = await failure(
      service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }),
    );

    expect(error).toMatchObject({ code: "browser_not_ready" });
    expect(error.message).toContain("The next agent browser tool installs it");
    expect(engine.created).toEqual([]);
  });

  test("names the window problem when no Electron window can show tabs", async () => {
    const { service } = createBrowserServiceHarness({
      engine: { state: () => ({ kind: "no_window" }) },
    });

    const error = await failure(
      service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }),
    );

    expect(error).toMatchObject({ code: "browser_no_window" });
  });

  test("refuses a missing task and an archived Workspace Session", async () => {
    const { service } = createBrowserServiceHarness({ archivedSessions: ["session-1"] });

    const task = await failure(
      service.openTab({
        owner: { ...taskOwner, taskId: "missing" },
        tabId: tabId(1),
        address: null,
      }),
    );
    const session = await failure(
      service.openTab({ owner: sessionOwner, tabId: tabId(2), address: null }),
    );

    expect(task).toMatchObject({ code: "browser_owner_unavailable" });
    expect(session).toMatchObject({ code: "browser_owner_unavailable" });
    expect(session.message).toContain("archived");
  });

  test("allows 8 tabs for each owner and names the limit", async () => {
    const { service } = createBrowserServiceHarness();
    for (let index = 1; index <= BROWSER_TAB_LIMIT; index += 1) {
      await run(service.openTab({ owner: taskOwner, tabId: tabId(index), address: null }));
    }

    const error = await failure(
      service.openTab({ owner: taskOwner, tabId: tabId(99), address: null }),
    );
    const otherOwner = await run(
      service.openTab({
        owner: { ...taskOwner, taskId: "task-2" },
        tabId: tabId(100),
        address: null,
      }),
    );

    expect(error).toMatchObject({ code: "browser_tab_limit" });
    expect(error.message).toContain("8");
    expect(otherOwner.tabId).toBe(tabId(100));
  });

  test("saves each tab with its URL, title, creator, and sharing, and forgets it on close", async () => {
    const { service, tabFile } = createBrowserServiceHarness();
    await run(
      service.openTab({
        owner: taskOwner,
        tabId: tabId(1),
        address: "localhost:3000/app",
      }),
    );
    await run(service.openTab({ owner: taskOwner, tabId: tabId(2), address: null }));
    await run(service.setShared({ tabId: tabId(1), shared: true }));

    await waitUntil(() => tabFile.current.tabs.some((tab) => tab.shared));
    expect(tabFile.current.tabs).toEqual([
      {
        tabId: tabId(1),
        owner: taskOwner,
        url: "http://localhost:3000/app",
        title: null,
        createdBy: "user",
        shared: true,
      },
      // A blank page cannot load again, so the saved URL stays empty.
      { tabId: tabId(2), owner: taskOwner, url: "", title: null, createdBy: "user", shared: false },
    ]);

    await run(service.closeTab(tabId(1)));
    await waitUntil(() => tabFile.current.tabs.length === 1);
    expect(tabFile.current.tabs.map((tab) => tab.tabId)).toEqual([tabId(2)]);
  });

  test("brings saved tabs back without a page until they start", async () => {
    const { service, engine, tabFile } = createBrowserServiceHarness({
      savedTabs: [
        {
          tabId: tabId(1),
          owner: taskOwner,
          url: "http://localhost:3000/",
          title: "App",
          createdBy: "agent",
          shared: false,
        },
        {
          tabId: tabId(2),
          owner: taskOwner,
          url: "",
          title: null,
          createdBy: "user",
          shared: true,
        },
      ],
    });

    const listed = await run(service.listTabs());

    expect(listed).toMatchObject([
      {
        tabId: tabId(1),
        started: false,
        live: false,
        url: "http://localhost:3000/",
        title: "App",
      },
      { tabId: tabId(2), started: false, url: "about:blank", createdBy: "user", shared: true },
    ]);
    expect(engine.created).toEqual([]);

    const started = await run(service.startTab(tabId(1)));
    const again = await run(service.startTab(tabId(1)));

    expect(started).toMatchObject({ started: true, error: null });
    expect(again.revision).toBe(started.revision);
    expect(engine.created).toEqual([tabId(1)]);
    // Loading the saved tabs and starting one change no saved field.
    expect(tabFile.writes).toBe(0);
  });

  test("two starts of one saved tab at the same time create its page once", async () => {
    const release = Deferred.makeUnsafe<void>();
    const { service, engine } = createBrowserServiceHarness({
      beforeTaskLookup: Deferred.await(release),
      savedTabs: [
        {
          tabId: tabId(1),
          owner: taskOwner,
          url: "",
          title: null,
          createdBy: "user",
          shared: false,
        },
      ],
    });

    const first = run(service.startTab(tabId(1)));
    const second = run(service.startTab(tabId(1)));
    Deferred.doneUnsafe(release, Exit.void);

    await Promise.all([first, second]);
    expect(engine.created).toEqual([tabId(1)]);
  });

  test("a start that fails shows the failure in the tab, and the tab does not start", async () => {
    const { service } = createBrowserServiceHarness({
      archivedSessions: ["session-1"],
      savedTabs: [
        {
          tabId: tabId(1),
          owner: sessionOwner,
          url: "http://localhost:3000/",
          title: null,
          createdBy: "user",
          shared: false,
        },
      ],
    });

    const error = await failure(service.startTab(tabId(1)));
    const [tab] = await run(service.listTabs());

    expect(error).toMatchObject({ code: "browser_owner_unavailable" });
    expect(tab).toMatchObject({
      started: false,
      error: { kind: "load_failed", url: "http://localhost:3000/", message: error.message },
    });
  });

  test("saved tabs count toward the tab limit of their owner", async () => {
    const { service } = createBrowserServiceHarness({
      savedTabs: Array.from({ length: BROWSER_TAB_LIMIT }, (_, index) => ({
        tabId: tabId(index + 1),
        owner: taskOwner,
        url: "",
        title: null,
        createdBy: "user" as const,
        shared: false,
      })),
    });

    const error = await failure(
      service.openTab({ owner: taskOwner, tabId: tabId(99), address: null }),
    );

    expect(error).toMatchObject({ code: "browser_tab_limit" });
  });

  test("a saved tab file that cannot be read fails tab use with the file path and is never replaced", async () => {
    const { service, tabFile } = createBrowserServiceHarness({ savedTabsUnreadable: true });

    const listed = await failure(service.listTabs());
    const opened = await failure(
      service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }),
    );

    expect(listed.message).toContain("/config/browser/chrome_for_testing-tabs.json");
    expect(listed.message).toContain("Fix or delete the file");
    expect(opened.message).toBe(listed.message);
    expect(tabFile.writes).toBe(0);
  });

  test("reports a failed save once, and the next change saves again", async () => {
    const { service, events, tabFile } = createBrowserServiceHarness();
    tabFile.failWrites = true;
    await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    await run(service.openTab({ owner: taskOwner, tabId: tabId(2), address: null }));
    await waitUntil(() => tabFile.writes >= 2);

    const notices = events.filter((event) => event.type === "tabs_not_saved");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ message: expect.stringContaining("The disk is full.") });

    tabFile.failWrites = false;
    await run(service.setShared({ tabId: tabId(1), shared: true }));
    await waitUntil(() => tabFile.current.tabs.length === 2);
    expect(tabFile.current.tabs[0]).toMatchObject({ tabId: tabId(1), shared: true });
  });

  test("closes a tab and its popup windows and publishes the close", async () => {
    const { service, engine, events } = createBrowserServiceHarness();
    await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    engine.emit({
      type: "popup_opened",
      openerTabId: tabId(1),
      tabId: tabId(2),
      url: "https://accounts.example.com/",
      surface: "popup_window",
      keepsOpener: true,
    });

    await run(service.closeTab(tabId(1)));

    expect(engine.closed).toEqual([tabId(1), tabId(2)]);
    expect(
      events.filter((event) => event.type === "tab_closed").map((event) => event.tabId),
    ).toEqual([tabId(1), tabId(2)]);
    expect(await run(service.listTabs())).toEqual([]);
  });

  test("removes a tab whose page closed by itself, with its popup windows", async () => {
    const { service, engine, events } = createBrowserServiceHarness();
    await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    engine.emit({
      type: "popup_opened",
      openerTabId: tabId(1),
      tabId: tabId(2),
      url: "https://accounts.example.com/",
      surface: "popup_window",
      keepsOpener: true,
    });

    engine.emit({ type: "tab_ended", tabId: tabId(1) });
    await waitUntil(() => events.filter((event) => event.type === "tab_closed").length === 2);

    // The engine close of the ended tab frees what the engine keeps for it, such as downloads.
    expect(engine.closed).toEqual([tabId(1), tabId(2)]);
    expect(await run(service.listTabs())).toEqual([]);
  });

  test("closes a tab that the engine no longer knows", async () => {
    const { service, events } = createBrowserServiceHarness({
      engine: {
        closeTab: (closedTabId) =>
          Effect.fail(
            new BrowserEngineError({
              code: "tab_not_found",
              operation: "test.closeTab",
              message: `Browser tab ${closedTabId} does not exist.`,
              tabId: closedTabId,
            }),
          ),
      },
    });
    await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));

    await run(service.closeTab(tabId(1)));

    expect(events.some((event) => event.type === "tab_closed")).toBe(true);
    expect(await run(service.listTabs())).toEqual([]);
  });

  test("shares only user tabs", async () => {
    const { service, engine } = createBrowserServiceHarness();
    await run(service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    engine.emit({
      type: "popup_opened",
      openerTabId: tabId(1),
      tabId: tabId(2),
      url: "https://example.com/",
      surface: "panel",
      keepsOpener: true,
    });

    const shared = await run(service.setShared({ tabId: tabId(1), shared: true }));

    expect(shared.shared).toBe(true);
    const popup = (await run(service.listTabs())).find((tab) => tab.tabId === tabId(2));
    expect(popup).toMatchObject({ createdBy: "user", shared: false, openerTabId: tabId(1) });
  });
});

describe("browser service popups and engine events", () => {
  const openFullOwner = async (harness: ReturnType<typeof createBrowserServiceHarness>) => {
    for (let index = 1; index <= BROWSER_TAB_LIMIT; index += 1) {
      await run(
        harness.service.openTab({
          owner: taskOwner,
          tabId: tabId(index),
          address: null,
        }),
      );
    }
  };

  test("gives a popup the owner, creator, and sharing of its opener", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    await run(harness.service.setShared({ tabId: tabId(1), shared: true }));

    harness.engine.emit({
      type: "popup_opened",
      openerTabId: tabId(1),
      tabId: tabId(2),
      url: "https://example.com/",
      surface: "panel",
      keepsOpener: false,
    });

    const popup = (await run(harness.service.listTabs())).find((tab) => tab.tabId === tabId(2));
    expect(popup).toMatchObject({
      createdBy: "user",
      shared: true,
      openerTabId: null,
      surface: "panel",
      owner: { taskId: "task-1" },
    });
  });

  test("closes a popup at the tab limit and tells the opener", async () => {
    const harness = createBrowserServiceHarness();
    await openFullOwner(harness);

    harness.engine.emit({
      type: "popup_opened",
      openerTabId: tabId(1),
      tabId: tabId(50),
      url: "https://example.com/",
      surface: "panel",
      keepsOpener: true,
    });
    await waitUntil(() => harness.engine.closed.length > 0);

    expect(harness.engine.closed).toEqual([tabId(50)]);
    expect(harness.events).toContainEqual({
      type: "notice",
      tabId: tabId(1),
      owner: taskOwner,
      notice: { kind: "popup_limit", limit: BROWSER_TAB_LIMIT },
    });
  });

  test("answers a saved permission at once and asks for an unknown one", async () => {
    const harness = createBrowserServiceHarness();
    harness.sitePermissionFiles.set("workspace-1", {
      version: 1,
      sites: { "http://localhost:3000": { camera: "denied" } },
    });
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    const answers: boolean[] = [];

    harness.engine.emit({
      type: "permission_requested",
      tabId: tabId(1),
      origin: "http://localhost:3000",
      permission: "camera",
      respond: (granted) => answers.push(granted),
      onEnded: () => () => {},
    });
    harness.engine.emit({
      type: "permission_requested",
      tabId: tabId(1),
      origin: "http://localhost:3000",
      permission: "geolocation",
      respond: (granted) => answers.push(granted),
      onEnded: () => () => {},
    });
    await waitUntil(() => answers.length > 0);

    expect(answers).toEqual([false]);
    const prompt = (await run(harness.service.listTabs()))[0]?.prompts[0];
    expect(prompt).toMatchObject({ kind: "permission", permission: "geolocation" });
    await run(
      harness.service.answerPrompt({
        tabId: tabId(1),
        promptId: prompt?.promptId ?? "",
        answer: { kind: "permission", allow: true },
      }),
    );
    expect(answers).toEqual([false, true]);
    expect(harness.sitePermissionFiles.get("workspace-1")?.sites["http://localhost:3000"]).toEqual({
      camera: "denied",
      geolocation: "granted",
    });
    const saved = await run(
      harness.service.readSitePermissions({
        workspaceId: "workspace-1",
        origin: "http://localhost:3000",
      }),
    );
    expect(saved.permissions).toEqual([
      { permission: "camera", decision: "denied" },
      { permission: "geolocation", decision: "granted" },
    ]);
  });

  test("a reset ends the live engine grants first, then clears the saved choice", async () => {
    const revoked: Array<[string, string, string | null]> = [];
    let engineFails = false;
    const harness = createBrowserServiceHarness({
      engine: {
        revokeSitePermissions: (workspaceId, origin, permission) =>
          engineFails
            ? Effect.fail(
                new BrowserEngineError({
                  code: "operation_failed",
                  operation: "test.revoke",
                  message: "Chrome is gone.",
                }),
              )
            : Effect.sync(() => void revoked.push([workspaceId, origin, permission])),
      },
    });
    harness.sitePermissionFiles.set("workspace-1", {
      version: 1,
      sites: { "http://localhost:3000": { camera: "granted", geolocation: "granted" } },
    });
    const reset = (permission: "camera" | null) =>
      harness.service.resetSitePermissions({
        workspaceId: "workspace-1",
        origin: "http://localhost:3000",
        permission,
      });

    await run(reset("camera"));
    expect(revoked).toEqual([["workspace-1", "http://localhost:3000", "camera"]]);
    expect(harness.sitePermissionFiles.get("workspace-1")?.sites["http://localhost:3000"]).toEqual({
      geolocation: "granted",
    });

    engineFails = true;
    const failed = await failure(reset(null));
    expect(failed.code).toBe("browser_engine_error");
    expect(failed.message).toContain("Chrome is gone.");
    // The saved choice stays, so the site menu never shows a cleared choice that still works.
    expect(harness.sitePermissionFiles.get("workspace-1")?.sites["http://localhost:3000"]).toEqual({
      geolocation: "granted",
    });
  });

  test("a saved answer behind a slow read reaches the engine before a later reset", async () => {
    const read = Deferred.makeUnsafe<void>();
    const log: string[] = [];
    const harness = createBrowserServiceHarness({
      beforeSitePermissionRead: Deferred.await(read),
      engine: {
        revokeSitePermissions: (_workspaceId, origin, permission) =>
          Effect.sync(() => void log.push(`revoke ${origin} ${permission ?? "all"}`)),
      },
    });
    harness.sitePermissionFiles.set("workspace-1", {
      version: 1,
      sites: { "http://localhost:3000": { camera: "granted" } },
    });
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    const requestCamera = () =>
      harness.engine.emit({
        type: "permission_requested",
        tabId: tabId(1),
        origin: "http://localhost:3000",
        permission: "camera",
        respond: (granted) => void log.push(`respond ${granted}`),
        onEnded: () => () => {},
      });

    requestCamera();
    const reset = run(
      harness.service.resetSitePermissions({
        workspaceId: "workspace-1",
        origin: "http://localhost:3000",
        permission: null,
      }),
    );
    Deferred.doneUnsafe(read, Exit.void);
    await reset;

    expect(log).toEqual(["respond true", "revoke http://localhost:3000 all"]);
    // The read that started before the reset does not bring back the cleared choice.
    requestCamera();
    await waitUntil(() => (Effect.runSync(harness.service.listTabs())[0]?.prompts.length ?? 0) > 0);
    expect(log).toHaveLength(2);
    expect(harness.sitePermissionFiles.get("workspace-1")?.sites).toEqual({});
  });

  test("a second answer to the same prompt fails", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    harness.engine.emit({
      type: "permission_requested",
      tabId: tabId(1),
      origin: "https://example.com",
      permission: "microphone",
      respond: () => {},
      onEnded: () => () => {},
    });
    await waitUntil(() =>
      harness.events.some((event) => event.type === "tab_upserted" && event.tab.prompts.length > 0),
    );
    const promptId = (await run(harness.service.listTabs()))[0]?.prompts[0]?.promptId ?? "";
    const answer = {
      tabId: tabId(1),
      promptId,
      answer: { kind: "permission" as const, allow: false },
    };

    await run(harness.service.answerPrompt(answer));
    const error = await failure(harness.service.answerPrompt(answer));

    expect(error).toMatchObject({ code: "browser_prompt_not_found" });
  });

  test("answers subresource certificate errors from accepted hosts and never asks", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    const answers: boolean[] = [];
    const certificateError = (host: string, mainFrame: boolean) =>
      harness.engine.emit({
        type: "certificate_error",
        tabId: tabId(1),
        url: `https://${host}/asset.js`,
        host,
        error: "net::ERR_CERT_AUTHORITY_INVALID",
        mainFrame,
        respond: (proceed) => answers.push(proceed),
      });

    certificateError("cdn.example", false);
    certificateError("dev.local", true);
    const promptId = (await run(harness.service.listTabs()))[0]?.prompts[0]?.promptId ?? "";
    // Proceed saves the exception, then fails to load the page again: the test engine has none.
    await run(
      Effect.ignore(
        harness.service.answerPrompt({
          tabId: tabId(1),
          promptId,
          answer: { kind: "certificate", proceed: true },
        }),
      ),
    );
    certificateError("dev.local", false);

    expect(answers).toEqual([false, false, true]);
    const tab = (await run(harness.service.listTabs()))[0];
    expect(tab?.prompts.filter((prompt) => prompt.kind === "certificate")).toEqual([]);
  });

  test("publishes downloads, refused schemes, notifications, and engine state", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));

    harness.engine.emit({
      type: "download_updated",
      tabId: tabId(1),
      download: {
        downloadId: "d1",
        url: "http://localhost/file.zip",
        fileName: "file.zip",
        state: "in_progress",
        receivedBytes: 1,
        totalBytes: 10,
        error: null,
      },
    });
    harness.engine.emit({ type: "scheme_refused", tabId: tabId(1), scheme: "mailto" });
    harness.engine.emit({
      type: "page_notification",
      tabId: tabId(1),
      origin: "http://localhost",
      title: "Build done",
      body: "OK",
    });
    harness.engine.emit({ type: "state_changed", state: { kind: "verifying", version: "1" } });

    expect((await run(harness.service.listTabs()))[0]?.downloads).toHaveLength(1);
    expect(harness.events.map((event) => event.type)).toContain("engine_changed");
    expect(
      harness.events.flatMap((event) => (event.type === "notice" ? [event.notice.kind] : [])),
    ).toEqual(["scheme_refused", "page_notification"]);
  });

  test("removing a workspace closes its tabs and deletes its saved permissions", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    harness.sitePermissionFiles.set("workspace-1", { version: 1, sites: {} });

    await run(harness.service.removeWorkspace("workspace-1"));

    expect(harness.engine.closed).toEqual([tabId(1)]);
    expect(harness.sitePermissionFiles.has("workspace-1")).toBe(false);
  });

  test("removing a workspace closes an opener with its popup window on the first try", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    harness.engine.emit({
      type: "popup_opened",
      openerTabId: tabId(1),
      tabId: tabId(2),
      url: "https://accounts.example.com/",
      surface: "popup_window",
      keepsOpener: true,
    });

    await run(harness.service.removeWorkspace("workspace-1"));

    expect(harness.engine.closed).toEqual([tabId(1), tabId(2)]);
    expect(await run(harness.service.listTabs())).toEqual([]);
  });

  test("closes the tabs of one owner and keeps the tabs of other owners", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    await run(harness.service.openTab({ owner: sessionOwner, tabId: tabId(2), address: null }));

    await run(harness.service.closeOwnerTabs(taskOwner));

    expect(harness.engine.closed).toEqual([tabId(1)]);
    expect((await run(harness.service.listTabs())).map((tab) => tab.tabId)).toEqual([tabId(2)]);
  });
});

describe("browser service engine features", () => {
  test("DevTools and popup windows are desktop features", async () => {
    const harness = createBrowserServiceHarness();
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));

    expect(await failure(harness.service.openDevTools(tabId(1)))).toMatchObject({
      code: "browser_unsupported",
    });
    expect(await failure(harness.service.showPopupWindow(tabId(1)))).toMatchObject({
      code: "browser_unsupported",
    });
  });

  test("an unknown tab fails as not found", async () => {
    const harness = createBrowserServiceHarness();

    expect(await failure(harness.service.closeTab(tabId(9)))).toMatchObject({
      code: "browser_tab_not_found",
    });
  });
});

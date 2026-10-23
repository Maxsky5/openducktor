import { describe, expect, test } from "bun:test";
import { type BrowserTabOwner, type OdtBrowserToolResult } from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { createTaskServiceTestDouble } from "../../test-support/task-service-test-double";
import type {
  BrowserCallerResolver,
  BrowserCallerResolverInput,
} from "../browser/browser-caller-resolver";
import { BrowserServiceError } from "../browser/browser-service-error";
import type { BrowserService } from "../browser/browser-service-types";
import { createOdtMcpBridgeService } from "./odt-mcp-bridge-service";

const TAB_ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";
const owner: BrowserTabOwner = {
  kind: "task",
  workspaceId: "repo",
  taskId: "task-1",
};
const clickResult: OdtBrowserToolResult = { content: [{ type: "text", text: "Clicked e12" }] };

type BrowserRun = { owner: BrowserTabOwner; toolName: string; input: JSONType };

const createBridge = ({
  resolve = () => Effect.succeed(owner),
  runAgentTool = () => Effect.succeed(clickResult),
}: {
  resolve?: BrowserCallerResolver["resolve"];
  runAgentTool?: (
    owner: BrowserTabOwner,
    toolName: string,
    input: JSONType,
  ) => Effect.Effect<OdtBrowserToolResult, BrowserServiceError>;
} = {}) => {
  const resolved: BrowserCallerResolverInput[] = [];
  const runs: BrowserRun[] = [];
  const browserAgentTools: Pick<BrowserService, "runAgentTool"> = {
    runAgentTool: (runOwner, toolName, input) => {
      const json: JSONType = JSON.parse(JSON.stringify(input));
      runs.push({ owner: runOwner, toolName, input: json });
      return runAgentTool(runOwner, toolName, json);
    },
  };
  const bridge = createOdtMcpBridgeService({
    browserAgentTools,
    managedCallers: {
      resolve: () => Effect.die(new Error("This tool does not resolve managed callers.")),
    },
    browserCallers: {
      resolve: (input) => {
        resolved.push(input);
        return resolve(input);
      },
    },
    taskAssetReadService: {
      readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
    },
    taskService: {
      ...createTaskServiceTestDouble({}),
      qaApproved: () => Effect.die(new Error("Browser tools never approve QA.")),
      qaRejected: () => Effect.die(new Error("Browser tools never reject QA.")),
    },
    workspaceSettingsService: {
      getRepoConfig: () => Effect.die(new Error("Browser tools resolve the workspace themselves.")),
      listWorkspaces: () => Effect.succeed([]),
    },
  });
  return { bridge, resolved, runs };
};

const failureOf = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

describe("odt MCP bridge browser tools", () => {
  test("runs the tool for the owner of the calling session", async () => {
    const { bridge, resolved, runs } = createBridge();

    const result = await Effect.runPromise(
      bridge.invokeBrowserTool("odt_browser_click", {
        tabId: TAB_ID,
        ref: "e12",
        workspaceId: "repo",
        caller: { runtime: "codex", runtimeSessionId: "thread-1" },
      }),
    );

    expect(result).toEqual(clickResult);
    expect(resolved).toEqual([
      { workspaceId: "repo", caller: { runtime: "codex", runtimeSessionId: "thread-1" } },
    ]);
    expect(runs).toEqual([
      {
        owner,
        toolName: "odt_browser_click",
        input: { tabId: TAB_ID, ref: "e12", workspaceId: "repo" },
      },
    ]);
  });

  test.each([
    {
      name: "a body without a caller",
      body: { tabId: TAB_ID, ref: "e12", workspaceId: "repo" },
    },
    {
      name: "a caller of an unknown runtime",
      body: {
        tabId: TAB_ID,
        ref: "e12",
        workspaceId: "repo",
        caller: { runtime: "cursor", runtimeSessionId: "s-1" },
      },
    },
    {
      name: "tool input that the tool schema rejects",
      body: {
        tabId: TAB_ID,
        workspaceId: "repo",
        caller: { runtime: "codex", runtimeSessionId: "thread-1" },
      },
    },
    {
      name: "a body without a workspaceId",
      body: {
        tabId: TAB_ID,
        ref: "e12",
        caller: { runtime: "codex", runtimeSessionId: "thread-1" },
      },
    },
  ])("rejects $name before it resolves an owner", async ({ body }) => {
    const { bridge, resolved, runs } = createBridge();

    const error = await failureOf(bridge.invokeBrowserTool("odt_browser_click", body));

    expect(error).toMatchObject({ _tag: "HostValidationError" });
    expect(resolved).toEqual([]);
    expect(runs).toEqual([]);
  });

  test("an unmanaged caller fails before the browser runs", async () => {
    const unmanaged = new BrowserServiceError({
      code: "browser_unmanaged_caller",
      operation: "browser.resolveCaller",
      message: "Browser tools need a managed OpenDucktor session.",
    });
    const { bridge, runs } = createBridge({ resolve: () => Effect.fail(unmanaged) });

    const error = await failureOf(
      bridge.invokeBrowserTool("odt_browser_list", {
        workspaceId: "repo",
        caller: { runtime: "claude", runtimeSessionId: "claude-1" },
      }),
    );

    expect(error).toBe(unmanaged);
    expect(runs).toEqual([]);
  });

  test("keeps the browser service failure for the agent", async () => {
    const notShared = new BrowserServiceError({
      code: "browser_not_shared",
      operation: "browser.runAgentTool",
      message: "The user stopped sharing this tab.",
      tabId: TAB_ID,
    });
    const { bridge } = createBridge({ runAgentTool: () => Effect.fail(notShared) });

    const error = await failureOf(
      bridge.invokeBrowserTool("odt_browser_snapshot", {
        tabId: TAB_ID,
        workspaceId: "repo",
        caller: { runtime: "opencode", runtimeSessionId: "ses_1" },
      }),
    );

    expect(error).toBe(notShared);
  });

  test("rejects a browser result that is not MCP content", async () => {
    const { bridge } = createBridge({
      runAgentTool: () => Effect.succeed({ content: [] }),
    });

    const error = await failureOf(
      bridge.invokeBrowserTool("odt_browser_list", {
        workspaceId: "repo",
        caller: { runtime: "opencode", runtimeSessionId: "ses_1" },
      }),
    );

    expect(error).toMatchObject({
      _tag: "HostValidationError",
      details: { operation: "odt_browser_list.parse_response" },
    });
  });
});

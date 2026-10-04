import { expect, test, mock } from "bun:test";
import type { OpenCodeCreationSettings } from "@openducktor/contracts";
import {
  makeMockClient,
  OpencodeSdkAdapter,
  defaultRepoRuntimeInput,
  sessionRuntimeRef,
  startDefaultSession,
} from "./test-support";
import { PERMISSION_METADATA_KEY } from "./opencode-permission-ownership";

const denyCommands = { permission: "bash", pattern: "*", action: "deny" as const };
const allowGit = { permission: "bash", pattern: "git *", action: "allow" as const };

test("overlapping QA restores and retry leave no QA editing denial in a Builder fork", async () => {
  const client = makeMockClient({ sessionPermissions: [allowGit] });
  const update = client.client.session.update;
  client.client.session.update = async (request) => {
    const result = await update(request);
    if (!request.permission) return result;
    // The native primary response reads the full list after the append.
    return client.client.session.get({ sessionID: request.sessionID, directory: "/repo" });
  };
  const adapter = new OpencodeSdkAdapter({ createClient: () => client.client });
  const qaRef = sessionRuntimeRef(undefined, { role: "qa" });
  const restores = await Promise.allSettled([
    adapter.resumeSession(qaRef),
    adapter.resumeSession(qaRef),
  ]);
  expect(restores.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  await adapter.resumeSession(qaRef);
  const source = (await client.client.session.get({ sessionID: qaRef.externalSessionId })).data!;
  expect(source.permission?.filter((rule) => rule.permission === "edit")).toEqual([
    { permission: "edit", pattern: "*", action: "deny" },
  ]);
  await adapter.forkSession({
    ...defaultRepoRuntimeInput,
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    parentExternalSessionId: source.id,
  });
  const fork = (await client.client.session.get({ sessionID: "session-opencode-fork" })).data!;
  expect(fork.permission?.filter((rule) => rule.permission === "edit")).toEqual([]);
  expect(fork.permission?.[0]).toEqual(allowGit);
  expect((await client.client.session.get({ sessionID: source.id })).data?.permission).toEqual(
    source.permission,
  );
  await adapter.releaseSession(qaRef);
  await adapter.releaseSession(sessionRuntimeRef("session-opencode-fork", { role: "build" }));
});

test("a partial mandatory append cannot clear readiness or leak into a fork on retry", async () => {
  const client = makeMockClient();
  const adapter = new OpencodeSdkAdapter({ createClient: () => client.client });
  await startDefaultSession(adapter, "qa");
  const qaRef = sessionRuntimeRef(undefined, { role: "qa" });
  const update = client.client.session.update;
  await update({
    sessionID: qaRef.externalSessionId,
    permission: [{ permission: "webfetch", pattern: "*", action: "ask" }],
  });
  const before = (await client.client.session.get({ sessionID: qaRef.externalSessionId })).data!;
  client.client.session.update = async (request) =>
    update(request.permission ? { ...request, metadata: before.metadata! } : request);
  await expect(adapter.resumeSession(qaRef)).rejects.toThrow("metadata");
  const writes = client.session.updateCalls.filter((request) => request.permission).length;
  await expect(adapter.resumeSession(qaRef)).rejects.toThrow(/ownership|metadata/);
  expect(client.session.updateCalls.filter((request) => request.permission)).toHaveLength(writes);
  await expect(
    adapter.sendUserMessage({ ...qaRef, parts: [{ kind: "text", text: "Continue" }] }),
  ).rejects.toThrow(/ownership|metadata/);
  await expect(
    adapter.forkSession({ ...defaultRepoRuntimeInput, parentExternalSessionId: before.id }),
  ).rejects.toThrow(/ownership|metadata/);
  expect(client.session.forkCalls).toEqual([]);
  expect(client.session.promptAsyncCalls).toEqual([]);
  await adapter.releaseSession(qaRef);
  const restarted = new OpencodeSdkAdapter({ createClient: () => client.client });
  await expect(restarted.resumeSession(qaRef)).rejects.toThrow("confirmed ownership");
  await expect(
    restarted.forkSession({ ...defaultRepoRuntimeInput, parentExternalSessionId: before.id }),
  ).rejects.toThrow("unknown origin");
  expect(client.session.forkCalls).toEqual([]);
});

test("forks replace app layers after restart and retain identical native entries by position", async () => {
  const native = [allowGit, { permission: "read", pattern: "private/*", action: "deny" as const }];
  const client = makeMockClient({
    sessionId: "native",
    sessionPermissions: native,
    forkSessionIds: ["session-opencode-fork", "replacement"],
  });
  let settings: OpenCodeCreationSettings = {
    defaults: [denyCommands, allowGit],
    role: [{ permission: "edit", pattern: "*", action: "allow" }],
  };
  const resolve = mock(async () => settings);
  const options = { createClient: () => client.client, resolveCreationSettings: resolve };
  let adapter = new OpencodeSdkAdapter(options);
  await adapter.resumeSession(sessionRuntimeRef("native"));
  const installed = await client.client.session.get({ sessionID: "native", directory: "/repo" });
  expect(resolve).toHaveBeenCalledTimes(0);
  // Import keeps native entries. Its later mandatory append has exact ownership.
  await adapter.forkSession({ ...defaultRepoRuntimeInput, parentExternalSessionId: "native" });
  const firstFork = await client.client.session.get({
    sessionID: "session-opencode-fork",
    directory: "/repo",
  });
  expect(firstFork.data?.permission?.slice(0, 5)).toEqual([
    ...native,
    denyCommands,
    allowGit,
    settings.role[0]!,
  ]);
  expect(firstFork.data?.permission?.at(-1)?.permission).toContain("odt_");
  const sourceRules = structuredClone(firstFork.data?.permission);
  await adapter.releaseSession(sessionRuntimeRef("session-opencode-fork"));
  adapter = new OpencodeSdkAdapter(options);
  settings = { defaults: [{ permission: "webfetch", pattern: "*", action: "ask" }], role: [] };
  await adapter.forkSession({
    ...defaultRepoRuntimeInput,
    parentExternalSessionId: "session-opencode-fork",
  });
  const replacement = await client.client.session.get({
    sessionID: "replacement",
    directory: "/repo",
  });
  expect(replacement.data?.permission?.slice(0, 3)).toEqual([...native, settings.defaults[0]!]);
  expect(
    replacement.data?.permission?.some(
      (rule) => rule.permission === "bash" && rule.pattern === "*" && rule.action === "deny",
    ),
  ).toBe(false);
  expect(
    (await client.client.session.get({ sessionID: "session-opencode-fork", directory: "/repo" }))
      .data?.permission,
  ).toEqual(sourceRules);
  expect(
    (await client.client.session.get({ sessionID: "native", directory: "/repo" })).data?.permission,
  ).toEqual(installed.data?.permission);
  expect(resolve).toHaveBeenCalledTimes(2);
  await adapter.releaseSession(sessionRuntimeRef("replacement"));
});

test("captures a detached creation snapshot and never reloads it on resume or later turns", async () => {
  const client = makeMockClient();
  const settings: OpenCodeCreationSettings = {
    defaults: [denyCommands, allowGit],
    role: [{ permission: "edit", pattern: "*", action: "allow" }],
  };
  const resolver = mock(async () => settings);
  const status = client.client.mcp.status;
  client.client.mcp.status = async (...args) => {
    settings.defaults.length = 0;
    return status(...args);
  };
  const adapter = new OpencodeSdkAdapter({
    createClient: () => client.client,
    resolveCreationSettings: resolver,
  });
  await startDefaultSession(adapter, "qa");
  const permission = client.session.createCalls[0]?.permission;
  expect(permission?.slice(0, 2)).toEqual([denyCommands, allowGit]);
  expect(permission?.filter((rule) => rule.permission === "edit").at(-1)?.action).toBe("deny");
  await adapter.releaseSession(sessionRuntimeRef());
  const reopened = new OpencodeSdkAdapter({
    createClient: () => client.client,
    resolveCreationSettings: resolver,
  });
  await reopened.resumeSession(sessionRuntimeRef(undefined, { role: "qa" }));
  await reopened.sendUserMessage({
    ...sessionRuntimeRef(undefined, { role: "qa" }),
    parts: [{ kind: "text", text: "Continue" }],
  });
  expect(resolver).toHaveBeenCalledTimes(1);
  expect(client.session.updateCalls.filter((call) => call.permission)).toHaveLength(0);
  expect(client.session.promptAsyncCalls[0]).not.toHaveProperty("tools");
  await reopened.releaseSession(sessionRuntimeRef());
});

test("expands home paths with the selected runtime and preserves saved pattern text", async () => {
  const client = makeMockClient();
  const home = mock(async () => ({
    data: {
      home: "/runtime/home",
      state: "/state",
      config: "/config",
      worktree: "/repo",
      directory: "/repo",
    },
    error: undefined,
  }));
  client.client.path.get = home;
  const settings: OpenCodeCreationSettings = {
    defaults: [
      { permission: "read", pattern: "~/private/*", action: "deny" },
      { permission: "external_directory", pattern: "$HOME/shared/*", action: "allow" },
      { permission: "bash", pattern: "echo $HOME", action: "ask" },
    ],
    role: [],
  };
  const adapter = new OpencodeSdkAdapter({
    createClient: () => client.client,
    resolveCreationSettings: async () => settings,
  });
  await startDefaultSession(adapter);
  expect(
    client.session.createCalls[0]?.permission?.slice(0, 3).map((rule) => rule.pattern),
  ).toEqual(["/runtime/home/private/*", "/runtime/home/shared/*", "echo $HOME"]);
  expect(settings.defaults[0]?.pattern).toBe("~/private/*");
  expect(home).toHaveBeenCalledTimes(1);
  await adapter.releaseSession(sessionRuntimeRef());
});

test.each(["missing", "mismatch", "malformed"] as const)(
  "blocks creation and cleans up when ownership confirmation is %s",
  async (mode) => {
    const client = makeMockClient();
    const create = client.client.session.create;
    client.client.session.create = async (...args) => {
      const response = await create(...args);
      const data = response.data!;
      if (mode === "missing") data.metadata = {};
      if (mode === "malformed") data.metadata = { [PERMISSION_METADATA_KEY]: { version: 9 } };
      if (mode === "mismatch") data.permission = [];
      return response;
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => client.client });
    await expect(startDefaultSession(adapter)).rejects.toThrow(/permission|ownership/);
    expect(client.session.deleteCalls).toHaveLength(1);
    expect(client.session.promptAsyncCalls).toHaveLength(0);
  },
);

test("blocks ambiguous legacy forks before native creation without changing the source", async () => {
  const client = makeMockClient({
    sessionId: "legacy",
    sessionPermissions: [{ permission: "odt_*", pattern: "*", action: "deny" }],
  });
  const adapter = new OpencodeSdkAdapter({ createClient: () => client.client });
  await expect(
    adapter.forkSession({ ...defaultRepoRuntimeInput, parentExternalSessionId: "legacy" }),
  ).rejects.toThrow("predates confirmed");
  expect(client.session.forkCalls).toEqual([]);
  expect(client.session.updateCalls).toEqual([]);
});

test("malformed source ownership blocks forks before native creation", async () => {
  const client = makeMockClient({ sessionId: "native", sessionPermissions: [allowGit] });
  const get = client.client.session.get;
  client.client.session.get = async (...args) => {
    const response = await get(...args);
    return {
      ...response,
      data: {
        ...response.data!,
        metadata: {
          [PERMISSION_METADATA_KEY]: {
            version: 1,
            legacyAmbiguous: false,
            spans: [{ layer: "defaults", context: "qa", start: 1, rules: [allowGit] }],
          },
        },
      },
    };
  };
  const adapter = new OpencodeSdkAdapter({ createClient: () => client.client });
  await expect(
    adapter.forkSession({ ...defaultRepoRuntimeInput, parentExternalSessionId: "native" }),
  ).rejects.toThrow("does not match");
  expect(client.session.forkCalls).toEqual([]);
  expect(client.session.updateCalls).toEqual([]);
});

test("forks a native child using confirmed ancestor positions and leaves native denials intact", async () => {
  const parentClient = makeMockClient({
    sessionId: "parent-native",
    sessionPermissions: [denyCommands],
  });
  const parentAdapter = new OpencodeSdkAdapter({
    createClient: () => parentClient.client,
    resolveCreationSettings: async () => ({
      defaults: [denyCommands, { permission: "read", pattern: "old/*", action: "deny" }],
      role: [],
    }),
  });
  await parentAdapter.forkSession({
    ...defaultRepoRuntimeInput,
    parentExternalSessionId: "parent-native",
  });
  const parent = (
    await parentClient.client.session.get({
      sessionID: "session-opencode-fork",
      directory: "/repo",
    })
  ).data!;
  const inherited = parent.permission!.filter(
    (rule) => rule.action === "deny" || rule.permission === "external_directory",
  );
  const childRules = [
    ...inherited,
    { permission: "todowrite", pattern: "*", action: "deny" as const },
    { permission: "task", pattern: "*", action: "deny" as const },
  ];
  const childClient = makeMockClient({
    sessionId: "child",
    sessionPermissions: childRules,
    forkSessionId: "child-fork",
  });
  const get = childClient.client.session.get;
  childClient.client.session.get = async (...args) => {
    if (args[0].sessionID === parent.id) return { data: parent, error: undefined };
    const response = await get(...args);
    if (args[0].sessionID === "child")
      return { ...response, data: { ...response.data!, parentID: parent.id } };
    return response;
  };
  const resolver = mock(async () => ({ defaults: [], role: [] }));
  const adapter = new OpencodeSdkAdapter({
    createClient: () => childClient.client,
    resolveCreationSettings: resolver,
  });
  // Attachment adds only mandatory controls and records them; it does not reload settings.
  await adapter.resumeSession(sessionRuntimeRef("child"));
  expect(resolver).toHaveBeenCalledTimes(0);
  await adapter.forkSession({ ...defaultRepoRuntimeInput, parentExternalSessionId: "child" });
  const fork = (
    await childClient.client.session.get({ sessionID: "child-fork", directory: "/repo" })
  ).data!;
  expect(fork.permission?.slice(0, 3)).toEqual([
    denyCommands,
    childRules.at(-2)!,
    childRules.at(-1)!,
  ]);
  expect(fork.permission?.filter((rule) => rule.permission === "bash")).toEqual([denyCommands]);
  expect(
    fork.permission?.some((rule) => rule.permission === "read" && rule.pattern === "old/*"),
  ).toBe(false);
  expect(
    (
      await childClient.client.session.get({ sessionID: "child", directory: "/repo" })
    ).data?.permission?.slice(0, childRules.length),
  ).toEqual(childRules);
  await adapter.releaseSession(sessionRuntimeRef("child"));
  await adapter.releaseSession(sessionRuntimeRef("child-fork"));
  await parentAdapter.releaseSession(sessionRuntimeRef("session-opencode-fork"));
});

test("failed path reads stop creation before the native session exists", async () => {
  const client = makeMockClient();
  client.client.path.get = async () => {
    throw new Error("Runtime path API unavailable");
  };
  const adapter = new OpencodeSdkAdapter({
    createClient: () => client.client,
    resolveCreationSettings: async () => ({
      defaults: [{ permission: "read", pattern: "~/private/*", action: "deny" }],
      role: [],
    }),
  });
  await expect(startDefaultSession(adapter)).rejects.toThrow("Runtime path API unavailable");
  expect(client.session.createCalls).toEqual([]);
  expect(client.session.promptAsyncCalls).toEqual([]);
});

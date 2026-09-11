import { describe, expect, test } from "bun:test";
import {
  isRelevantSubscriberEvent,
  resolveOpencodeEventRecipients,
} from "./opencode-event-recipients";
import { makeSessionInput } from "./event-stream.test-support";
import {
  opencodeDirectEventSchema,
  type ParsedOpencodeEvent,
} from "./opencode-global-event-ingress";
import { createOpencodeSessionFixture } from "./opencode-protocol-test-fixtures";
import { RuntimeEventSubscribers } from "./runtime-event-subscribers";

const subscriber = (externalSessionId: string, directory = "/repo") => ({
  externalSessionId,
  input: { ...makeSessionInput(), workingDirectory: directory },
});

const permission = (sessionID: string) =>
  opencodeDirectEventSchema.parse({
    id: "event",
    type: "permission.v2.asked",
    properties: { id: "request", sessionID, action: "bash", resources: ["ls"] },
  });

const ids = (subscribers: Iterable<{ externalSessionId: string }>) =>
  [...subscribers].map(({ externalSessionId }) => externalSessionId);

describe("runtime event subscriber index", () => {
  test("selects expected recipients for indexed delivery and logging", () => {
    const registry = new RuntimeEventSubscribers();
    registry.set("parent", subscriber("parent"));
    registry.set("child", subscriber("child", "/other"));
    registry.set("neighbor", subscriber("neighbor", " /repo "));
    for (let index = 0; index < 97; index += 1) {
      const id = `unrelated-${index}`;
      registry.set(id, subscriber(id, "/unrelated"));
    }
    const parentByChild = new Map([["child", "parent"]]);
    const cases: Array<{ event: ParsedOpencodeEvent; expected: string[] }> = [
      { event: permission("child"), expected: ["parent", "child"] },
      { event: permission("unknown"), expected: [] },
      {
        event: opencodeDirectEventSchema.parse({
          id: "delta",
          type: "message.part.delta",
          properties: {
            sessionID: "child",
            messageID: "message",
            partID: "part",
            field: "text",
            delta: "text",
          },
        }),
        expected: ["child"],
      },
    ];
    for (const [sessionID, expected] of [
      [undefined, ["parent", "neighbor"]],
      ["child", ["child"]],
      ["unknown", []],
      ["", ["parent", "neighbor"]],
    ] as const) {
      cases.push({
        event: opencodeDirectEventSchema.parse({
          id: "error",
          type: "session.error",
          properties: { directory: " /repo ", sessionID },
        }),
        expected: [...expected],
      });
    }
    for (const type of ["session.created", "session.updated", "session.deleted"] as const) {
      for (const [id, parentID, expected] of [
        ["child", "parent", ["parent", "child"]],
        ["child", "neighbor", ["child", "neighbor"]],
        ["child", undefined, ["child"]],
        ["", "parent", ["parent", "child", "neighbor"]],
      ] as const) {
        const info = createOpencodeSessionFixture({ id });
        if (parentID !== undefined) info.parentID = parentID;
        cases.push({
          event: opencodeDirectEventSchema.parse({
            id: "lifecycle",
            type,
            properties: {
              sessionID: "child",
              directory: "/repo",
              info,
            },
          }),
          expected: [...expected],
        });
      }
    }
    for (const { event, expected } of cases) {
      const recipients = resolveOpencodeEventRecipients(event, parentByChild);
      for (const logging of [false, true]) {
        const selected = logging ? registry.values() : registry.forEvent(recipients);
        const actual = [...selected].filter((entry) =>
          isRelevantSubscriberEvent(entry, recipients),
        );
        expect(ids(actual)).toEqual(expected);
      }
    }
    expect(registry.size).toBe(100);
  });

  test("preserves direct delivery to a registered empty session id", () => {
    const registry = new RuntimeEventSubscribers();
    registry.set("", subscriber(""));
    const event = opencodeDirectEventSchema.parse({
      id: "idle",
      type: "session.idle",
      properties: { sessionID: "" },
    });
    expect(ids(registry.forEvent(resolveOpencodeEventRecipients(event, new Map())))).toEqual([""]);
  });

  test("updates directory membership and preserves registration order on replacement", () => {
    const registry = new RuntimeEventSubscribers();
    registry.set("first", subscriber("first", "/other"));
    registry.set("second", subscriber("second"));
    registry.set("first", subscriber("first"));
    expect(ids(registry.forDirectory(" /repo "))).toEqual(["first", "second"]);
    expect(ids(registry.forDirectory("/other"))).toEqual([]);
    registry.delete("first");
    registry.set("first", subscriber("first"));
    expect(ids(registry.forDirectory("/repo"))).toEqual(["second", "first"]);
    registry.delete("second");
    registry.delete("first");
    expect(registry.size).toBe(0);
    expect(ids(registry.forDirectory("/repo"))).toEqual([]);
  });

  test("skips a recipient released during delivery and reads replacements live", () => {
    const registry = new RuntimeEventSubscribers();
    registry.set("parent", subscriber("parent"));
    registry.set("child", subscriber("child"));
    const parentByChild = new Map([["child", "parent"]]);
    const delivered: string[] = [];
    for (const entry of registry.forEvent(
      resolveOpencodeEventRecipients(permission("child"), parentByChild),
    )) {
      delivered.push(entry.externalSessionId);
      registry.delete("child");
    }
    expect(delivered).toEqual(["parent"]);
    registry.set("child", subscriber("child"));
    const directories: string[] = [];
    for (const entry of registry.forEvent(
      resolveOpencodeEventRecipients(permission("child"), parentByChild),
    )) {
      directories.push(entry.input.workingDirectory);
      registry.set("child", subscriber("child", "/new"));
    }
    expect(directories).toEqual(["/repo", "/new"]);
  });

  test("checks directory relevance after a callback replaces the next subscriber", () => {
    const event = opencodeDirectEventSchema.parse({
      id: "error",
      type: "session.error",
      properties: { directory: "/repo" },
    });
    const recipients = resolveOpencodeEventRecipients(event, new Map());
    for (const logging of [false, true]) {
      const registry = new RuntimeEventSubscribers();
      registry.set("first", subscriber("first"));
      registry.set("second", subscriber("second"));
      const selected = logging ? registry.values() : registry.forEvent(recipients);
      const delivered: string[] = [];
      for (const entry of selected) {
        if (!isRelevantSubscriberEvent(entry, recipients)) continue;
        delivered.push(entry.externalSessionId);
        registry.set("second", subscriber("second", "/other"));
      }
      expect(delivered).toEqual(["first"]);
    }
  });
});

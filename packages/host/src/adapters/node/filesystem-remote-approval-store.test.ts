import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createFilesystemRemoteApprovalStore } from "./filesystem-remote-approval-store";
import type { RemoteHostOwner } from "../../ports/remote-approval-store";

const owner: RemoteHostOwner = { shell: "web", profile: "default" };
const approval = {
  clientId: "30000000-0000-4000-8000-000000000001",
  clientKind: "browser" as const,
  tokenHash: "a".repeat(64),
};
const open = (root: string, hostOwner = owner) =>
  Effect.runPromise(createFilesystemRemoteApprovalStore(root).open(hostOwner));
const scopeDirectory = async (root: string) => {
  const hosts = path.join(root, "remote-access", "hosts");
  return path.join(hosts, (await readdir(hosts))[0]!);
};

test("scopes approval identity, shares approvals within a scope, and keeps revocation after restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-remote-approvals-"));
  try {
    const store = await open(root);
    await Effect.runPromise(store.create(approval));
    const shared = await open(root);
    expect(shared.hostId).toBe(store.hostId);
    expect(await Effect.runPromise(shared.list())).toEqual([approval]);
    const other = await open(root, { shell: "electron", profile: "default" });
    expect(other.hostId).not.toBe(store.hostId);
    expect(await Effect.runPromise(other.list())).toEqual([]);
    await Effect.runPromise(shared.revoke(approval.clientId));
    expect(await Effect.runPromise(store.read(approval.clientId))).toBeNull();
    const restored = await open(root);
    expect(restored.hostId).toBe(store.hostId);
    expect(await Effect.runPromise(restored.list())).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lists approvals without failing on files that the store did not write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-remote-stray-"));
  try {
    const store = await open(root);
    await Effect.runPromise(store.create(approval));
    await writeFile(path.join(await scopeDirectory(root), "clients", ".DS_Store"), "");
    expect(await Effect.runPromise(store.list())).toEqual([approval]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing or damaged identity never resets a populated approval scope", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-remote-corrupt-"));
  try {
    const store = await open(root);
    await Effect.runPromise(store.create(approval));
    const directory = await scopeDirectory(root);
    const identity = path.join(directory, "identity.json");
    const original = await readFile(identity, "utf8");
    for (const damaged of [null, "{broken"]) {
      if (damaged === null) await rm(identity);
      else await writeFile(identity, damaged);
      await expect(open(root)).rejects.toMatchObject({ _tag: "HostOperationError" });
      expect(
        await readFile(path.join(directory, "clients", `${approval.clientId}.json`), "utf8"),
      ).toContain(approval.clientId);
      await writeFile(identity, original);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

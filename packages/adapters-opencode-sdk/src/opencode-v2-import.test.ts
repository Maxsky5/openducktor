import { expect, test } from "bun:test";
import { prepareFixture } from "./opencode-v2-live.test-support";
import { ref, response, session } from "./opencode-v2.test-support";

test("imports a conversation beside a workspace session of the same directory", async () => {
  const imported = session({ id: "ses_imported" });
  const fixture = prepareFixture(({ method, url }) =>
    method === "GET" && url.pathname === `/api/session/${imported.id}`
      ? response(imported)
      : undefined,
  );
  const runtime = await fixture.prepare();
  const sessionScope = { kind: "repository" as const, workspaceId: "workspace-1" };
  try {
    await runtime.connection.resumeSession({
      ...ref,
      runtimePolicy: { kind: "opencode" },
      sessionScope,
    });
    const source = await runtime.sessionImport.inspectSession({
      ...ref,
      externalSessionId: imported.id,
      sessionScope,
    });
    await source.attach();

    const read = await runtime.connection.readSessionSources(ref.repoPath);
    expect(
      read.sources.map((source) => [source.externalSessionId, source.sessionAssociation]),
    ).toEqual([
      [ref.externalSessionId, sessionScope],
      [imported.id, sessionScope],
    ]);
  } finally {
    await runtime.release();
  }
});

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  createOpencodeMessageInfoFixture,
  createOpencodeSessionFixture,
} from "../src/opencode-protocol-test-fixtures";

export const createRecoveryCostClient = (repoPath: string, count: () => void): OpencodeClient => {
  const session = (id: string) => {
    const row = createOpencodeSessionFixture({ id, directory: repoPath });
    if (id.startsWith("child-")) row.parentID = id.replace("child-", "root-");
    return row;
  };
  return createOpencodeClient({
    baseUrl: "http://fixture.invalid",
    fetch: Object.assign(
      async (input: RequestInfo | URL) => {
        count();
        await Bun.sleep(1);
        const url = new URL(new Request(input).url);
        if (url.pathname === "/session/status") return Response.json({});
        if (url.pathname === "/permission" || url.pathname === "/question")
          return Response.json([]);
        const match = /^\/session\/([^/]+)(?:\/(children|message))?$/u.exec(url.pathname);
        if (!match) throw new Error(`Unexpected native fixture route: ${url.pathname}`);
        const sessionID = match[1]!;
        if (match[2] === "children")
          return Response.json(
            sessionID.startsWith("root-") ? [session(sessionID.replace("root-", "child-"))] : [],
          );
        if (match[2] === "message")
          return Response.json(
            Array.from({ length: url.searchParams.get("limit") === "1" ? 1 : 128 }, (_, index) => ({
              info: createOpencodeMessageInfoFixture({
                id: `message-${index}`,
                role: "assistant",
                sessionID,
              }),
              parts: [
                {
                  type: "text",
                  id: `part-${index}`,
                  sessionID,
                  messageID: `message-${index}`,
                  text: "x".repeat(1024),
                },
              ],
            })),
          );
        return Response.json(session(sessionID));
      },
      {
        preconnect: () => {
          throw new Error("Unexpected fixture preconnect");
        },
      },
    ),
  });
};

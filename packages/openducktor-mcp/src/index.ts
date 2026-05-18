import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server";
import type { OdtStoreContext } from "./store-context";
import { toErrorMessage } from "./tool-results";

const parseCliArgs = (argv: string[]): OdtStoreContext => {
  const next: OdtStoreContext = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }

    const value = argv[index + 1];
    if (!value) {
      continue;
    }

    if (current === "--workspace-id") {
      next.workspaceId = value;
      index += 1;
      continue;
    }

    if (current === "--beads-attachment-dir") {
      next.beadsAttachmentDir = value;
      index += 1;
      continue;
    }

    if (current === "--host-url") {
      next.hostUrl = value;
      index += 1;
      continue;
    }

    if (current === "--host-token") {
      next.hostToken = value;
      index += 1;
      continue;
    }

    if (current === "--dolt-host") {
      next.doltHost = value;
      index += 1;
      continue;
    }

    if (current === "--dolt-port") {
      next.doltPort = value;
      index += 1;
      continue;
    }

    if (current === "--database-name" || current === "--database") {
      next.databaseName = value;
      index += 1;
      continue;
    }

    if (current === "--metadata-namespace") {
      throw new Error(
        "--metadata-namespace is no longer supported. Metadata namespace is owned by the OpenDucktor host.",
      );
    }
  }

  return next;
};

const startMcp = async (context: OdtStoreContext = {}): Promise<void> => {
  const server = await createMcpServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

if (import.meta.main) {
  const context = parseCliArgs(process.argv.slice(2));
  void startMcp(context).catch((error) => {
    // MCP stdio requires stderr for diagnostics.
    console.error(`[openducktor-mcp] ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

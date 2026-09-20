import { Effect } from "effect";
import { createFilesystemAdapter } from "../src/adapters/filesystem/filesystem-adapter";
import { createGitCliAdapter } from "../src/adapters/git/git-cli-adapter";
import { createWorkspaceFilesService } from "../src/application/filesystem/workspace-files-service";
import { createWorkspaceFilesCommandHandlers } from "../src/interface/commands/workspace-files-command-handlers";
import type { FilesystemPort } from "../src/ports/filesystem-port";

const [rootPath, relativePath] = process.argv.slice(2);
if (!rootPath || !relativePath) {
  throw new Error(
    "Usage: bun run packages/host/scripts/benchmark-workspace-file-tree.ts <repository> <tracked-text-file>",
  );
}
const filesystem = createFilesystemAdapter();
const git = createGitCliAdapter({ resolveCommand: () => Effect.succeed("git") });
let statCalls = 0;
let snapshotReads = 0;
const measuredFilesystem: FilesystemPort = {
  ...filesystem,
  stat: (path, options) => {
    statCalls += 1;
    return filesystem.stat(path, options);
  },
  readFileSnapshot: (path, maxBytes) => {
    snapshotReads += 1;
    return filesystem.readFileSnapshot(path, maxBytes);
  },
};
const commands = createWorkspaceFilesCommandHandlers(
  createWorkspaceFilesService(measuredFilesystem, git),
);
const measure = async <Value>(operation: () => Promise<Value>) => {
  statCalls = 0;
  snapshotReads = 0;
  const start = performance.now();
  const value = await operation();
  return {
    elapsed: performance.now() - start,
    statCalls,
    snapshotReads,
    value,
  };
};
const readTree = async () => {
  const { value, ...measurement } = await measure(() =>
    Effect.runPromise(commands.filesystem_list_tree({ rootPath })),
  );
  return { ...measurement, entries: value.entries.length };
};
const readFile = async () => {
  const { value, ...measurement } = await measure(() =>
    Effect.runPromise(commands.filesystem_read_text_file({ rootPath, relativePath })),
  );
  return { ...measurement, kind: value.kind };
};
console.log(
  JSON.stringify({
    firstTree: await readTree(),
    secondTree: await readTree(),
    firstFile: await readFile(),
    secondFile: await readFile(),
  }),
);

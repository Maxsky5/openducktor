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
let active = 0;
let peak = 0;
let calls = 0;
let onMetadataRead: (() => void) | undefined;
const measuredFilesystem: FilesystemPort = {
  ...filesystem,
  stat: (path, options) =>
    Effect.gen(function* () {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      if (options?.followSymbolicLinks === false) {
        onMetadataRead?.();
        onMetadataRead = undefined;
      }
      return yield* filesystem.stat(path, options).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            active -= 1;
          }),
        ),
      );
    }),
};
const treeCommands = createWorkspaceFilesCommandHandlers(
  createWorkspaceFilesService(measuredFilesystem, git),
);
const probeCommands = createWorkspaceFilesCommandHandlers(
  createWorkspaceFilesService(filesystem, git),
);
const readProbe = async () => {
  const start = performance.now();
  await Effect.runPromise(probeCommands.filesystem_read_text_file({ rootPath, relativePath }));
  return performance.now() - start;
};
const readTree = async (withProbe: boolean) => {
  calls = 0;
  peak = 0;
  let probe: Promise<number> | undefined;
  if (withProbe)
    onMetadataRead = () => {
      probe = readProbe();
    };
  const start = performance.now();
  const tree = await Effect.runPromise(treeCommands.filesystem_list_tree({ rootPath }));
  const elapsed = performance.now() - start;
  const probeMs = await probe;
  return { elapsed, probeMs, peak, calls, entries: tree.entries.length };
};
console.log(
  JSON.stringify({
    cold: await readTree(false),
    warm: await readTree(true),
    idleProbeMs: await readProbe(),
  }),
);

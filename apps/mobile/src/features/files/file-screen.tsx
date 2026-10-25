import { resolveChatFilePath } from "@openducktor/frontend-core/sessions/messages/chat-file-link";
import { Stack, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { WorkHeaderTitle } from "@/features/work-owner/work-header-title";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { EmptyState, LoadingState } from "@/ui/states";
import { FileViewer } from "./file-viewer";
import { fileScopeOf } from "./file-scope";

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

const directoryOf = (path: string): string | null => {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
};

/** One file of the Files view on a phone. Wide screens show it next to the folder. */
export function FileScreen(): ReactElement {
  const { path } = useLocalSearchParams<{ path?: string }>();
  return (
    <WorkOwnerScreen title={path ? fileName(path) : "File"} diffs={false}>
      {(owner) => {
        if (!path) {
          return (
            <EmptyState
              icon="file-question"
              title="Incomplete Link"
              message="It does not name a file. Open the file again from Files."
            />
          );
        }
        const rootPath = owner.git.workingDirectory;
        if (!rootPath && owner.git.workingDirectoryPending) {
          return <LoadingState label="Resolving the task worktree" />;
        }
        if (!rootPath) {
          return (
            <EmptyState
              icon="folder-x"
              title="File Unavailable"
              message={
                owner.git.workingDirectoryUnavailableReason ??
                "The working directory is unavailable."
              }
            />
          );
        }
        // A transcript link can name an absolute path. It opens only inside the owner directory.
        const link = resolveChatFilePath(
          path,
          rootPath,
          owner.ref.kind === "task" ? "task" : "workspace",
        );
        if (link.kind !== "file" || link.file.access === "local") {
          return (
            <EmptyState
              icon="folder-x"
              title="File Unavailable"
              message={
                link.kind === "invalid"
                  ? link.message
                  : `${path} is outside ${owner.ref.kind === "task" ? "the task worktree" : "the chat directory"}. The app opens only files inside it.`
              }
            />
          );
        }
        const relativePath = link.file.relativePath;
        return (
          <>
            <Stack.Screen
              options={{
                title: fileName(relativePath),
                headerTitle: () => (
                  <WorkHeaderTitle
                    title={fileName(relativePath)}
                    subtitle={directoryOf(relativePath)}
                  />
                ),
              }}
            />
            <FileViewer
              rootPath={rootPath}
              relativePath={relativePath}
              scope={fileScopeOf(owner)}
            />
          </>
        );
      }}
    </WorkOwnerScreen>
  );
}

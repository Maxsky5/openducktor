import type { FreeTaskArtifact, TaskArtifact, WorkspaceRef } from "@openducktor/contracts";
import { artifactQueryKeys, readTaskArtifact } from "@openducktor/frontend-core/queries/artifacts";
import {
  artifactPreviewKind,
  decodeArtifactText,
} from "@openducktor/frontend-core/tasks/artifacts/artifact-presentation";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { ResourceFiles } from "@/platform/resource-files";

/** What the view of a saved file shows. A text format carries its text. */
export type ArtifactPreview =
  | { kind: "image" | "none" }
  | { kind: "markdown" | "text" | "html"; text: string }
  /** A text format whose bytes are not valid UTF-8. */
  | { kind: "invalid-text" };

/** A read of a saved file into a device file. The file goes away when its last view closes. */
export type ArtifactFile = {
  artifact: TaskArtifact;
  uri: string;
  preview: ArtifactPreview;
};

/** Read the complete file once, then keep its device URI in the query cache. */
export const artifactFileQueryOptions = (
  queryClient: QueryClient,
  files: ResourceFiles,
  scope: WorkspaceRef,
  artifact: FreeTaskArtifact,
) =>
  queryOptions({
    queryKey: artifactQueryKeys.file(scope, artifact.taskId, artifact.artifactId),
    queryFn: async (context): Promise<ArtifactFile> => {
      const file = files.createPartFile(artifact.fileName);
      try {
        const read = await readTaskArtifact(
          queryClient,
          { ...scope, taskId: artifact.taskId, artifactId: artifact.artifactId },
          context,
        );
        await file.appendBase64(read.dataBase64);
        const kind = artifactPreviewKind(read.artifact.mediaType);
        if (kind === "image" || kind === "none")
          return { artifact: read.artifact, uri: file.uri, preview: { kind } };
        const text = decodeArtifactText(await files.readBytes(file.uri));
        return {
          artifact: read.artifact,
          uri: file.uri,
          preview: text === null ? { kind: "invalid-text" } : { kind, text },
        };
      } catch (error) {
        files.remove(file.uri);
        throw error;
      }
    },
    // Live artifact changes and host recovery read a changed file again.
    staleTime: Infinity,
    gcTime: 0,
  });

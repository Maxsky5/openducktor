import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createResourceFiles,
  type ResourceFiles,
  watchResourceFileRemoval,
} from "./resource-files";

const ResourceFilesContext = createContext<ResourceFiles | null>(null);

/**
 * Owns the resource cache folder of one connection and deletes it with the connection. When
 * `onRelease` is set, it receives the result of that deletion instead of a thrown error.
 */
export function ResourceFilesProvider({
  connectionKey,
  onRelease,
  children,
}: PropsWithChildren<{
  connectionKey: number;
  onRelease?: ((failure: Error | undefined) => void) | undefined;
}>): ReactElement {
  const queryClient = useQueryClient();
  const [files] = useState(() => createResourceFiles(connectionKey));
  const releaseRef = useRef(onRelease);
  useEffect(() => {
    const stop = watchResourceFileRemoval(queryClient, files);
    const report = releaseRef.current;
    return () => {
      stop();
      if (!report) {
        files.dispose();
        return;
      }
      try {
        files.dispose();
      } catch (cause) {
        report(cause instanceof Error ? cause : new Error(String(cause)));
        return;
      }
      report(undefined);
    };
  }, [files, queryClient]);
  return <ResourceFilesContext value={files}>{children}</ResourceFilesContext>;
}

export const useResourceFiles = (): ResourceFiles => {
  const files = use(ResourceFilesContext);
  if (!files) throw new Error("Resource views need the resource files of a host connection.");
  return files;
};

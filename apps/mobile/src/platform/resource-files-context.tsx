import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useEffect,
  useState,
} from "react";
import {
  createResourceFiles,
  type ResourceFiles,
  watchResourceFileRemoval,
} from "./resource-files";

const ResourceFilesContext = createContext<ResourceFiles | null>(null);

/** Owns the resource cache folder of one connection and deletes it with the connection. */
export function ResourceFilesProvider({
  connectionKey,
  children,
}: PropsWithChildren<{ connectionKey: number }>): ReactElement {
  const queryClient = useQueryClient();
  const [files] = useState(() => createResourceFiles(connectionKey));
  useEffect(() => {
    const stop = watchResourceFileRemoval(queryClient, files);
    return () => {
      stop();
      files.dispose();
    };
  }, [files, queryClient]);
  return <ResourceFilesContext value={files}>{children}</ResourceFilesContext>;
}

export const useResourceFiles = (): ResourceFiles => {
  const files = use(ResourceFilesContext);
  if (!files) throw new Error("Resource views need the resource files of a host connection.");
  return files;
};

import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { readWorkOwnerRef, type WorkOwnerRef } from "./work-owner-params";

/** The work owner that the route params of this screen name, or null for an invalid link. */
export const useWorkOwnerRef = (): WorkOwnerRef | null => {
  const { workspaceId, taskId, externalSessionId, runtimeKind, workingDirectory } =
    useLocalSearchParams();
  return useMemo(
    () =>
      readWorkOwnerRef({ workspaceId, taskId, externalSessionId, runtimeKind, workingDirectory }),
    [externalSessionId, runtimeKind, taskId, workingDirectory, workspaceId],
  );
};

import { settingsSnapshotQueryOptions } from "./workspace";
import { useQuery } from "@tanstack/react-query";

/** The global Git setting that a task close follows. Its data is undefined while it loads. */
export const useGlobalRemoveWorktreeOnClose = () =>
  useQuery({
    ...settingsSnapshotQueryOptions(),
    select: (snapshot) => snapshot.git.removeWorktreeOnClose,
  });

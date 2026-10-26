import { routes, type WorkOwnerParams } from "@/navigation/routes";
import type { IconName } from "@/ui/icon";

type WorkViewLinkKey = "changes" | "files" | "artifacts" | "checks" | "terminals";

export type WorkViewLink = {
  key: WorkViewLinkKey;
  label: string;
  icon: IconName;
  route:
    | ReturnType<typeof routes.changes>
    | ReturnType<typeof routes.files>
    | ReturnType<typeof routes.artifacts>
    | ReturnType<typeof routes.checks>
    | ReturnType<typeof routes.terminals>;
};

/**
 * The work views of a session owner. A task has Changes, Files, Artifacts, CI Checks, and
 * Terminals. A chat has Changes, Files, and Terminals.
 */
export const buildWorkViewLinks = (owner: WorkOwnerParams | null): WorkViewLink[] => {
  if (!owner) return [];
  const links: WorkViewLink[] = [
    { key: "changes", label: "Changes", icon: "file-diff", route: routes.changes(owner) },
    { key: "files", label: "Files", icon: "folder", route: routes.files(owner) },
  ];
  if ("taskId" in owner) {
    links.push(
      {
        key: "artifacts",
        label: "Artifacts",
        icon: "files",
        route: routes.artifacts(owner.workspaceId, owner.taskId),
      },
      {
        key: "checks",
        label: "CI Checks",
        icon: "circle-check",
        route: routes.checks(owner.workspaceId, owner.taskId),
      },
    );
  }
  links.push({
    key: "terminals",
    label: "Terminals",
    icon: "terminal",
    route: routes.terminals(owner),
  });
  return links;
};

import type { SettingsConfigView, WorkspaceCatalogRepo } from "../../ports/settings-config-port";

export type AutopilotWorkspaceView = {
  state: "open" | "closed" | "removing";
  /** Changes each time the workspace opens, so an attempt from before a close can skip. */
  generation: number;
};

const workspaceState = ({
  closed,
  removal,
}: Pick<WorkspaceCatalogRepo, "closed" | "removal">): AutopilotWorkspaceView["state"] => {
  if (removal) return "removing";
  if (closed) return "closed";
  return "open";
};

/**
 * Holds the Autopilot view of each workspace. `forget` runs when a workspace starts its removal
 * or disappears, so its waiting attempts and outcomes go.
 */
export const createAutopilotWorkspaceViews = (forget: (workspaceId: string) => void) => {
  const views = new Map<string, AutopilotWorkspaceView>();
  let lastGeneration = 0;

  const remove = (workspaceId: string): void => {
    views.delete(workspaceId);
    forget(workspaceId);
  };

  /** Replaces the view of one workspace. */
  const apply = (
    workspaceId: string,
    state: AutopilotWorkspaceView["state"],
  ): AutopilotWorkspaceView => {
    const known = views.get(workspaceId);
    if (state === "removing" && known?.state !== "removing") forget(workspaceId);
    const view: AutopilotWorkspaceView = {
      state,
      generation:
        state === "open" && known?.state !== "open"
          ? ++lastGeneration
          : (known?.generation ?? lastGeneration),
    };
    views.set(workspaceId, view);
    return view;
  };

  return {
    get: (workspaceId: string) => views.get(workspaceId),
    /** A committed status change shows that the workspace was open, also after another host opened it. */
    open: (workspaceId: string) => apply(workspaceId, "open"),
    applyAll: (next: SettingsConfigView): void => {
      for (const workspaceId of views.keys())
        if (!(workspaceId in next.workspaces)) remove(workspaceId);
      for (const [workspaceId, repo] of Object.entries(next.workspaces))
        apply(workspaceId, workspaceState(repo));
    },
    clear: () => views.clear(),
  };
};

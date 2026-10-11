// The sessions of the opening view. The sidebar lists the sessions of all workspaces: the agents
// of the Fieldnotes board, and the sessions of two other workspaces.
import type { NavData } from "../../replica/shell/nav";
import { NAV_SESSIONS } from "../../sample/nav";

/** The first frame: four agents run, and nobody waits for you. Two sessions start later. */
export const HERO_NAV: NavData = {
  scope: "all",
  entries: [
    NAV_SESSIONS["shortcut-build"],
    NAV_SESSIONS["empty-build"],
    NAV_SESSIONS["focus-qa"],
    NAV_SESSIONS["api-build"],
    NAV_SESSIONS["titles-spec"],
    NAV_SESSIONS["typing-qa"],
    NAV_SESSIONS["tags-chat"],
    NAV_SESSIONS["theme-plan"],
    { ...NAV_SESSIONS["titles-planner"], later: true },
    { ...NAV_SESSIONS["shortcut-qa"], later: true },
  ],
};

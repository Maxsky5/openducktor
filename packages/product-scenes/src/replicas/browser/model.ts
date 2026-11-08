// The data of a browser tab that the panel tab and the toolbar show.

/**
 * Who opened a browser tab, and who can use it. A user tab shows Share with agents, and agents can use it only when it
 * is shared. A tab that an agent opened shows the Agent badge.
 */
export type BrowserAccess = { owner: "agent" } | { owner: "user"; shared: boolean };

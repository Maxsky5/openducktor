// The cards of the Fieldnotes board that the opening view and the palette view share. The tasks
// are fictional.
import type { CardData } from "../replica/board/model";

export const CARDS = {
  sync: { name: "sync", task: "b8t1", action: "Start Builder" },
  export: { name: "export", task: "m2q7", action: "Start Spec" },
  titles: { name: "titles", task: "h5w3", action: "Start Planner", links: ["Spec"] },
  empty: { name: "empty", task: "p6d4", session: { role: "Builder", status: "Running" } },
  shortcut: {
    name: "shortcut",
    task: "k3x9",
    session: { role: "Builder", status: "Running" },
    links: ["Spec", "Planner"],
  },
  focus: {
    name: "focus",
    task: "r9c2",
    session: { role: "QA", status: "Running" },
    links: ["Builder"],
  },
  typing: {
    name: "typing",
    task: "t4n8",
    action: "Approve Task",
    pr: 41,
    links: ["Builder", "QA"],
  },
} as const satisfies Record<string, CardData>;

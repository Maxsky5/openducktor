// The repository actions of repo-actions-split-button.tsx: two joined outline buttons. The first
// runs the default action and shows only its icon. The chevron opens the menu of the other
// actions and Manage actions. The menu stays closed in the static frame, and a scene opens it. A
// view can give its own actions in place of the sample repository actions.
import {
  Bug,
  ChevronDown,
  FlaskConical,
  Hammer,
  ListChecks,
  type LucideIcon,
  Play,
  Settings2,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { REPO_ACTIONS, type RepoAction, type RepoActionIcon } from "../../sample/actions";
import "./RepoActions.css";

const ICONS = {
  play: Play,
  test: FlaskConical,
  lint: ListChecks,
  configure: Wrench,
  build: Hammer,
  debug: Bug,
} as const satisfies Record<RepoActionIcon, LucideIcon>;

type RepoActionsProps = {
  /** The actions by id, in the saved order. One of them is the default action. */
  actions?: Readonly<Record<string, RepoAction>>;
};

export function RepoActions({ actions: byId = REPO_ACTIONS }: RepoActionsProps): ReactElement {
  const actions = Object.entries(byId).map(([id, action]) => ({ id, ...action }));
  const main = actions.find((action) => action.isDefault);
  if (!main) throw new Error("The sample repository needs a default action.");
  const MainIcon = ICONS[main.icon];
  return (
    <span className="ra">
      <span className="ra-run" data-repo-run="">
        <MainIcon />
      </span>
      <span className="ra-more" data-repo-more="">
        <ChevronDown />
      </span>
      <span className="ra-menu" hidden data-repo-menu="">
        {actions
          .filter((action) => action !== main)
          .map((action) => {
            const Icon = ICONS[action.icon];
            return (
              <span className="ra-item" data-repo-item={action.id} key={action.id}>
                <Icon />
                {action.name}
              </span>
            );
          })}
        <hr />
        <span className="ra-item">
          <Settings2 />
          Manage actions
        </span>
      </span>
    </span>
  );
}

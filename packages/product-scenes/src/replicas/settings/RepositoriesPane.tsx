// The Repositories section of the Settings dialog from the lg breakpoint: RepositorySidebar next to
// the tab of the selected repository section, as settings-modal.tsx lays them out.
import type { ReactElement, ReactNode } from "react";
import { type RepositorySection, RepositorySidebar } from "./RepositorySidebar";
import "./RepositoriesPane.css";

type RepositoriesPaneProps = {
  /** The name of the selected repository. */
  repository: string;
  section: RepositorySection;
  /** The tab of the section. */
  children: ReactNode;
};

export function RepositoriesPane({
  repository,
  section,
  children,
}: RepositoriesPaneProps): ReactElement {
  return (
    <div className="repos-pane">
      <RepositorySidebar repository={repository} section={section} />
      {children}
    </div>
  );
}

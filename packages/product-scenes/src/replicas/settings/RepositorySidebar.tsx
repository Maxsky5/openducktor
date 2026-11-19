// The repository menu of the Repositories section of the Settings dialog: RepositorySidebar of
// settings-modal-sidebars.tsx, with the repository selector and the sections of
// REPOSITORY_SECTIONS in settings-modal-constants.ts. The selected section has the accent look.
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import "./RepositorySidebar.css";

/** The labels of REPOSITORY_SECTIONS in the order of the app. */
export const REPOSITORY_SECTIONS = [
  "Configuration",
  "Scripts",
  "Git",
  "Agents",
  "Repository prompts",
] as const;

export type RepositorySection = (typeof REPOSITORY_SECTIONS)[number];

type RepositorySidebarProps = {
  /** The name of the selected repository. */
  repository: string;
  section: RepositorySection;
};

export function RepositorySidebar({ repository, section }: RepositorySidebarProps): ReactElement {
  return (
    <div className="repo-side">
      <div className="repo-pick">
        <span>Repository</span>
        <Combobox>
          <span>{repository}</span>
        </Combobox>
      </div>
      <div className="repo-sections">
        {REPOSITORY_SECTIONS.map((label) => (
          <Button
            variant={label === section ? "accent" : "ghost"}
            className="repo-section"
            key={label}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

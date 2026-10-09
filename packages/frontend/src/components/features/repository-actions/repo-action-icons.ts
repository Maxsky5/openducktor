import type { RepoActionIcon } from "@openducktor/contracts";
import { Bug, FlaskConical, Hammer, ListChecks, type LucideIcon, Play, Wrench } from "lucide-react";

type IconPresentation = {
  icon: LucideIcon;
  label: string;
};

export const REPO_ACTION_ICONS = {
  play: { icon: Play, label: "Play" },
  test: { icon: FlaskConical, label: "Test" },
  lint: { icon: ListChecks, label: "Lint" },
  configure: { icon: Wrench, label: "Configure" },
  build: { icon: Hammer, label: "Build" },
  debug: { icon: Bug, label: "Debug" },
} satisfies Record<RepoActionIcon, IconPresentation>;

import { memo, type ReactElement } from "react";

import { TaskDetailsCollapsibleCard } from "./task-details-collapsible-card";
import { TaskDetailsMarkdownContent } from "./task-details-markdown-content";

type TaskDetailsDocumentSectionProps = {
  title: string;
  icon: ReactElement;
  markdown: string;
  updatedAt: string | null;
  empty: string;
  defaultExpanded?: boolean;
};

export const TaskDetailsDocumentSection = memo(
  function TaskDetailsDocumentSection({
    title,
    icon,
    markdown,
    updatedAt,
    empty,
    defaultExpanded = false,
  }: TaskDetailsDocumentSectionProps): ReactElement {
    return (
      <TaskDetailsCollapsibleCard
        title={title}
        icon={icon}
        updatedAt={updatedAt}
        defaultExpanded={defaultExpanded}
      >
        {({ isExpanded }) => (
          <TaskDetailsMarkdownContent active={isExpanded} markdown={markdown} empty={empty} />
        )}
      </TaskDetailsCollapsibleCard>
    );
  },
  (previous, next) =>
    previous.title === next.title &&
    previous.markdown === next.markdown &&
    previous.updatedAt === next.updatedAt &&
    previous.empty === next.empty &&
    previous.defaultExpanded === next.defaultExpanded &&
    previous.icon === next.icon,
);

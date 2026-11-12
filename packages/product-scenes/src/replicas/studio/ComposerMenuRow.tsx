// A row of a composer menu: AgentChatComposerMenuRow of agent-chat-composer-menu.tsx. A round icon,
// the name with the source badge of a slash command, a second line, the description, and a
// chevron. A skill has a purple icon, as agent-chat-composer-skill-menu.tsx draws it.
import { ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import "./ComposerMenuRow.css";

type ComposerMenuRowProps = {
  name: string;
  /** The icon in the round badge. */
  icon: ReactNode;
  /** The source badge of a slash command, such as custom. */
  badge?: string | undefined;
  /** The argument hints of a slash command, such as those of /goal, in a monospace font. */
  hint?: string | undefined;
  /** The label of a skill, or the path of a file. */
  detail?: string | undefined;
  description?: string | undefined;
  tone?: "muted" | "skill";
  active?: boolean;
  /** The text that a typed query filters, such as the trigger of a slash command. The name by default. */
  match?: string;
};

export function ComposerMenuRow({
  name,
  icon,
  badge,
  hint,
  detail,
  description,
  tone = "muted",
  active = false,
  match,
}: ComposerMenuRowProps): ReactElement {
  return (
    <span className="cm-row" data-active={flag(active)} data-option={match ?? name}>
      <span className="cm-row-icon" data-tone={tone}>
        {icon}
      </span>
      <span className="cm-row-text">
        <span className="cm-row-name">
          {badge ? (
            <>
              <span>{name}</span>
              <small>{badge}</small>
              {hint && <code className="cm-row-hint">{hint}</code>}
            </>
          ) : (
            name
          )}
        </span>
        {detail && <span className="cm-row-detail">{detail}</span>}
        {description && <span className="cm-row-desc">{description}</span>}
      </span>
      <ChevronRight className="cm-row-chevron" />
    </span>
  );
}

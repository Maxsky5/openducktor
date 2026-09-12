import { type ReactElement, useMemo, useState } from "react";
import type { AgentToolData } from "@openducktor/contracts";
import { cn } from "@/lib/utils";
import { relativizeDisplayPathsInValue } from "./tool-path-utils";

const formatToolInput = (input: AgentToolData, workingDirectory?: string | null): string => {
  return JSON.stringify(relativizeDisplayPathsInValue(input, workingDirectory), null, 2);
};

type ToolInputDetailsProps = {
  input: AgentToolData;
  workingDirectory?: string | null | undefined;
  className: string;
  textClassName: string;
  visible?: boolean;
};

export const ToolInputDetails = ({
  input,
  workingDirectory,
  className,
  textClassName,
  visible = true,
}: ToolInputDetailsProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const formatted = useMemo(
    () => (isOpen && visible ? formatToolInput(input, workingDirectory) : null),
    [input, workingDirectory, isOpen, visible],
  );
  return (
    <details className={className} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={cn("cursor-pointer px-2 py-1 text-xs font-medium", textClassName)}>
        Input
      </summary>
      {formatted !== null ? (
        <pre
          className={cn("overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px]", textClassName)}
        >
          {formatted}
        </pre>
      ) : null}
    </details>
  );
};

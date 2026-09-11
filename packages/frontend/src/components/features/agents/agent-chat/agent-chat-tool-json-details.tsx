import type { ReactElement } from "react";
import { formatRawJsonLikeText } from "./agent-chat-message-card-model";

type ToolJsonDetailsProps = {
  label: "Input" | "Output" | "Error";
  value: string;
  className: string;
  titleClassName: string;
  open?: boolean;
};

export const ToolJsonDetails = ({
  label,
  value,
  className,
  titleClassName,
  open,
}: ToolJsonDetailsProps): ReactElement => {
  return (
    <details className={className} open={open}>
      <summary className={titleClassName}>{label}</summary>
      <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px]">
        {formatRawJsonLikeText(value)}
      </pre>
    </details>
  );
};

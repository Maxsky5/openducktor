// The "Questions and answers" details under an answered request_user_input row.
import type { ReactElement } from "react";
import type { Answer } from "./model";
import "./Answers.css";

export function Answers({ items }: { items: readonly Answer[] }): ReactElement {
  return (
    <div className="st-answers" data-answers="">
      <span>Questions and answers</span>
      <dl>
        {items.map((item) => (
          <div key={item.prompt}>
            <dt>{item.prompt}</dt>
            <dd>{item.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

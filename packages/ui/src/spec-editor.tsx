import { specTemplateSections } from "@openblueprint/contracts";
import type { ChangeEvent, ReactElement } from "react";

type Props = {
  markdown: string;
  missing: string[];
  onChange: (markdown: string) => void;
  onSave: () => void;
};

export function SpecEditor({ markdown, missing, onChange, onSave }: Props): ReactElement {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <h3 style={{ marginBottom: 0 }}>Specification</h3>
      <p style={{ marginTop: 0, fontSize: 13 }}>
        Required sections include explicit purpose guidance and are enforced before save.
      </p>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
        {specTemplateSections.map((section) => (
          <li key={section.heading}>
            <strong>{section.heading}</strong>: {section.purpose}
          </li>
        ))}
      </ul>
      <textarea
        value={markdown}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value)}
        rows={20}
        style={{ width: "100%", fontFamily: "Menlo, monospace", fontSize: 13 }}
      />
      {missing.length > 0 ? (
        <p style={{ color: "#b91c1c", margin: 0 }}>
          Missing required sections: {missing.join(", ")}
        </p>
      ) : (
        <p style={{ color: "#166534", margin: 0 }}>Template validation passed.</p>
      )}
      <button type="button" onClick={onSave} disabled={missing.length > 0}>
        Save Spec (set_spec_markdown)
      </button>
    </section>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { specTemplateSections } from "@openblueprint/contracts";
import { CheckCircle2, CircleDotDashed } from "lucide-react";
import type { ReactElement } from "react";

type SpecTemplateGuardrailsProps = {
  missingHeadings: Set<string>;
};

export function SpecTemplateGuardrails({
  missingHeadings,
}: SpecTemplateGuardrailsProps): ReactElement {
  return (
    <Card className="h-full border-slate-200">
      <CardHeader>
        <CardTitle className="text-lg">Template Guardrails</CardTitle>
        <CardDescription>
          Each section includes explicit purpose text and is required before save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {specTemplateSections.map((section) => {
          const missing = missingHeadings.has(section.heading.toLowerCase());
          return (
            <div
              key={section.heading}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                {missing ? (
                  <CircleDotDashed className="size-4 text-amber-600" />
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                )}
                {section.heading}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{section.purpose}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

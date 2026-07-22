import katex from "katex";
import { type ChangeEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type TaskDescriptionMathKind = "inline" | "block";

export type TaskDescriptionMathEdit = {
  kind: TaskDescriptionMathKind;
  latex: string;
  position?: number;
};

const validateFormula = (latex: string, kind: TaskDescriptionMathKind): string | null => {
  if (!latex) {
    return "Enter a LaTeX formula.";
  }
  if (latex.includes("$")) {
    return "Enter the formula without dollar delimiters; Markdown delimiters are added for you.";
  }
  if (kind === "inline" && /[\r\n]/.test(latex)) {
    return "Inline formulas must stay on one line.";
  }
  try {
    katex.renderToString(latex, { displayMode: kind === "block", throwOnError: true });
    return null;
  } catch {
    return "Enter valid LaTeX before saving the formula.";
  }
};

export function TaskDescriptionMathDialog({
  edit,
  onCancel,
  onSubmit,
}: {
  edit: TaskDescriptionMathEdit;
  onCancel(): void;
  onSubmit(latex: string): boolean;
}) {
  const [latex, setLatex] = useState(edit.latex);
  const [error, setError] = useState<string | null>(null);
  const editing = edit.position !== undefined;
  const action = editing ? "Edit" : "Insert";
  const title = `${action} ${edit.kind} formula`;

  const save = (): void => {
    const nextLatex = latex.trim();
    const validationError = validateFormula(nextLatex, edit.kind);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!onSubmit(nextLatex)) {
      setError("The selected formula is no longer available. Select it again and retry.");
    }
  };

  const fieldProps = {
    id: "task-description-latex",
    value: latex,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? "task-description-latex-error" : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setLatex(event.currentTarget.value);
      setError(null);
    },
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          onKeyDown={(event) => {
            const submitsInline = edit.kind === "inline" && event.key === "Enter";
            const submitsBlock = event.key === "Enter" && (event.metaKey || event.ctrlKey);
            if (submitsInline || submitsBlock) {
              event.preventDefault();
              save();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Enter LaTeX without Markdown dollar delimiters. Select an existing formula to edit it.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-4 space-y-2 overflow-visible">
            <Label htmlFor="task-description-latex">LaTeX formula</Label>
            {edit.kind === "inline" ? (
              <Input {...fieldProps} autoFocus placeholder="e^{i\\pi} + 1 = 0" />
            ) : (
              <Textarea {...fieldProps} autoFocus rows={5} placeholder="\\int_0^1 x^2 \\, dx" />
            )}
            {error ? (
              <p
                id="task-description-latex-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Press {edit.kind === "inline" ? "Enter" : "Ctrl+Enter or Command+Enter"} to save.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">{editing ? "Save formula" : "Insert formula"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

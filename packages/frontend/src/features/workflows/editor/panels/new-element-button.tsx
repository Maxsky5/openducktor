import { Plus } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useDialogPresence,
} from "@/components/ui/dialog";
import { OptionCard, OptionCardMark } from "@/components/ui/option-card";
import { RadioGroup } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WORKFLOW_DIALOG } from "../../workflow-dialog";

export type KindOption<Kind extends string> = {
  readonly value: Kind;
  readonly label: string;
  /** One line that tells what the kind does, or why it is off. */
  readonly description: string;
  /** The kind cannot be picked now. */
  readonly disabled?: boolean;
};

type Kinds<Kind extends string> = readonly [KindOption<Kind>, ...KindOption<Kind>[]];

type NewElementButtonProps<Kind extends string> = {
  /** The command, such as "Add state". It is the popover title too. */
  label: string;
  placeholder: string;
  /** An outlined button, a section header icon, or a link in an empty section. */
  variant?: "button" | "icon" | "link";
} & (
  | {
      kinds?: undefined;
      /** Creates the element. Its ID comes from this first name. */
      onCreate: (name: string) => void;
    }
  | {
      /** The kinds to choose from. The first kind that is on is the default. */
      kinds: Kinds<Kind>;
      onCreate: (name: string, kind: Kind) => void;
    }
);

/** The brand-coloured text link of an empty section, such as "Add a step". */
/**
 * The menu of a narrow trigger, such as a pill or an add link: as wide as its options, never
 * narrower than its trigger, so no option is cut.
 */
export const CONTENT_MENU_CLASS =
  "w-max min-w-[max(var(--radix-popover-trigger-width),14rem)] max-w-[min(22rem,var(--radix-popover-content-available-width))]";

export const LINK_BUTTON_CLASS =
  "inline-flex items-center gap-1 self-start rounded-sm text-xs font-medium text-(--workflow-selection) underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AddTrigger({
  label,
  variant,
  ...props
}: {
  label: string;
  variant: NonNullable<NewElementButtonProps<string>["variant"]>;
  onClick: () => void;
}): ReactElement {
  if (variant === "icon")
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label={label}
            {...props}
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  if (variant === "link")
    return (
      <button type="button" className={LINK_BUTTON_CLASS} {...props}>
        <Plus aria-hidden="true" className="size-3.5" />
        {label}
      </button>
    );
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5 bg-sidebar shadow-xs"
      {...props}
    >
      <Plus className="size-3.5" />
      {label}
    </Button>
  );
}

function KindChoice<Kind extends string>({
  kinds,
  value,
  onChange,
}: {
  kinds: Kinds<Kind>;
  value: Kind;
  onChange: (kind: Kind) => void;
}): ReactElement {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        const kind = kinds.find((option) => option.value === next);
        if (kind) onChange(kind.value);
      }}
      aria-label="Type"
      className="gap-1.5"
    >
      {kinds.map((option) => (
        <OptionCard
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="flex items-start gap-2.5 px-3 py-2"
        >
          <OptionCardMark className="mt-0.5" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium leading-5">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </span>
        </OptionCard>
      ))}
    </RadioGroup>
  );
}

/** The dialog that asks for the name, and the kind when there is a choice, of a new element. */
function NewElementDialog<Kind extends string>({
  open,
  onOpenChange,
  props,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  props: NewElementButtonProps<Kind>;
}): ReactElement {
  const { label, placeholder, kinds } = props;
  const id = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind | undefined>(
    () => kinds?.find((option) => !option.disabled)?.value,
  );
  const valid = name.trim().length > 0 && (kinds === undefined || kind !== undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={WORKFLOW_DIALOG.sm}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            if (!props.kinds) props.onCreate(name.trim());
            else if (kind !== undefined) props.onCreate(name.trim(), kind);
            onOpenChange(false);
          }}
        >
          <DialogHeader className={WORKFLOW_DIALOG.header}>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription className="sr-only">
              Name the new element{kinds ? " and pick its type" : ""}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className={cn(WORKFLOW_DIALOG.body, "flex flex-col gap-4")}>
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>Name</Label>
              <Input
                id={id}
                autoFocus
                value={name}
                placeholder={placeholder}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </div>
            {kinds && kind !== undefined ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Type</span>
                <KindChoice kinds={kinds} value={kind} onChange={setKind} />
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter className={WORKFLOW_DIALOG.footer}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              <Plus className="size-4" />
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A trigger that opens the dialog of a new element. */
export function NewElementButton<Kind extends string = never>(
  props: NewElementButtonProps<Kind>,
): ReactElement {
  const [open, setOpen] = useState(false);
  const mounted = useDialogPresence(open);
  return (
    <>
      <AddTrigger
        label={props.label}
        variant={props.variant ?? "button"}
        onClick={() => setOpen(true)}
      />
      {mounted ? <NewElementDialog open={open} onOpenChange={setOpen} props={props} /> : null}
    </>
  );
}

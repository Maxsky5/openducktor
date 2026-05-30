import type * as React from "react";
import {
  type SegmentedControlItemClassNameOptions,
  type SegmentedControlRootVariantProps,
  segmentedControlItemClassName,
  segmentedControlRootClassName,
} from "./segmented-control-classnames";

type SegmentedControlRootProps = React.ComponentProps<"div"> & SegmentedControlRootVariantProps;

export function SegmentedControlRoot({
  className,
  role = "group",
  size,
  ...props
}: SegmentedControlRootProps) {
  return (
    <div role={role} className={segmentedControlRootClassName({ size, className })} {...props} />
  );
}

type SegmentedControlItemProps = React.ComponentProps<"button"> &
  Omit<SegmentedControlItemClassNameOptions, "className" | "active"> & {
    active: boolean;
  };

export function SegmentedControlItem({
  active,
  "aria-pressed": ariaPressed,
  "aria-selected": ariaSelected,
  className,
  inactiveClassName,
  grow,
  role,
  size,
  type = "button",
  ...props
}: SegmentedControlItemProps) {
  const activeStateProps =
    role === "tab"
      ? { "aria-selected": ariaSelected ?? active }
      : { "aria-pressed": ariaPressed ?? active };

  return (
    <button
      type={type}
      role={role}
      className={segmentedControlItemClassName({
        active,
        grow,
        size,
        inactiveClassName,
        className,
      })}
      {...activeStateProps}
      {...props}
    />
  );
}

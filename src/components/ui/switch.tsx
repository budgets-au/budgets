"use client";

import { useState } from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Themed binary toggle. Size variants match the visual densities used
 * across the app:
 *   - default (h-5 w-9): primary settings rows, filter toolbars
 *   - sm      (h-4 w-7): inline next to text-xs labels (suggestions,
 *                        lineage row toggles)
 *   - xs      (h-3 w-6): inline next to text-[10px] labels (range
 *                        toggle in scheduled-edit-form)
 *
 * The on/off styling is driven by JS state mirrored from base-ui's
 * `onCheckedChange` rather than Tailwind `data-checked:` variants.
 * Tailwind v4 compiles those to `:where([data-checked]:not(...))` and
 * Safari was occasionally not repainting the thumb/track when the
 * attribute flipped — visible as a "stuck" toggle. Pure className
 * branching avoids that entirely.
 */
const switchVariants = cva(
  cn(
    "relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
    "outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ),
  {
    variants: {
      size: {
        default: "h-5 w-9",
        sm: "h-4 w-7",
        xs: "h-3 w-6",
      },
      checked: {
        true: "bg-indigo-600",
        false: "bg-muted dark:bg-slate-700",
      },
    },
    defaultVariants: { size: "default", checked: false },
  },
);

const thumbVariants = cva(
  cn(
    "pointer-events-none block rounded-full bg-white shadow-sm transition-transform",
  ),
  {
    variants: {
      size: {
        default: "h-4 w-4",
        sm: "h-3 w-3",
        xs: "h-2 w-2",
      },
      checked: { true: "", false: "" },
    },
    compoundVariants: [
      { size: "default", checked: true, class: "translate-x-4" },
      { size: "default", checked: false, class: "translate-x-0" },
      { size: "sm", checked: true, class: "translate-x-3" },
      { size: "sm", checked: false, class: "translate-x-0" },
      { size: "xs", checked: true, class: "translate-x-3" },
      { size: "xs", checked: false, class: "translate-x-0" },
    ],
    defaultVariants: { size: "default", checked: false },
  },
);

function Switch({
  className,
  size,
  checked,
  defaultChecked,
  onCheckedChange,
  ...props
}: SwitchPrimitive.Root.Props & VariantProps<typeof switchVariants>) {
  // Mirror base-ui's checked state into local state so className branching
  // can react. Controlled (checked prop) vs uncontrolled (defaultChecked)
  // both supported.
  const [internal, setInternal] = useState<boolean>(
    () => checked ?? defaultChecked ?? false,
  );
  const isChecked = checked ?? internal;

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(next, eventDetails) => {
        setInternal(next);
        onCheckedChange?.(next, eventDetails);
      }}
      className={cn(switchVariants({ size, checked: isChecked }), className)}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={thumbVariants({ size, checked: isChecked })}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

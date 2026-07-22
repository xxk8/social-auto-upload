import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { toneBorderClass, toneChipClasses, toneTextClass } from "@/lib/tone"

// ── `alertVariants` — cva() recipe driving <Alert>'s `variant` prop ────
//
// `alertVariants` is the cva() recipe for <Alert>'s `variant` prop.
// It is intentionally module-local — NOT re-exported from this file —
// because exporting it triggers
// `react-refresh/only-export-components`, AND because downstream code
// should wrap <Alert variant="..."> rather than paste alert class
// strings around the codebase.
//
// Fork-from-stale rationale: a feature-local cva() clone forks from a
// recipe readers can't import, so they can't grep against the
// source-of-truth when `alert.tsx` tunes — drift is invisible until
// it bites. The same invariant that motivated button.tsx / badge.tsx /
// sheet.tsx applies here.
//
// Same pattern as `button.tsx` (buttonVariants), `badge.tsx`
// (badgeVariants), `sheet.tsx` (sheetVariants). The four together
// form the verified "module-local cva" set; DESIGN-components.md
// `cross-cutting.sweep-status` tracks this list as the canonical
// reference.
//
// Type-side escape hatch (NOT deprecated): consumers that need the
// `variant` type union can index `React.ComponentProps<typeof Alert>['variant']`
// directly. Alert's internal `VariantProps<typeof alertVariants>`
// mixed-prop inheritance exposes `variant` as a public literal. Like
// `ButtonProps`/`SheetContentProps`, the cva() callable is what's
// gated; the prop literal is public.
const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
        // ── DESIGN.md status tokens (index.css). All four status variants
        //    are composed from `@/lib/tone` helpers — single source of truth
        //    shared by Alert / Toast / Badge / ChipBar / ValidityBadge.
        //    `[&_h5]:font-semibold` upgrades the AlertTitle weight on the
        //    four status variants only (default notices stay at font-medium).
        success: cn(
          "[&_h5]:font-semibold",
          toneChipClasses("success"),
          toneBorderClass("success"),
          `[&>svg]:${toneTextClass("success")}`,
        ),
        warning: cn(
          "[&_h5]:font-semibold",
          toneChipClasses("warning"),
          toneBorderClass("warning"),
          `[&>svg]:${toneTextClass("warning")}`,
        ),
        info: cn(
          "[&_h5]:font-semibold",
          toneChipClasses("info"),
          toneBorderClass("info"),
          `[&>svg]:${toneTextClass("info")}`,
        ),
        error: cn(
          "[&_h5]:font-semibold",
          toneChipClasses("error"),
          toneBorderClass("error"),
          `[&>svg]:${toneTextClass("error")}`,
        ),
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  )
)
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    // AlertTitle stays `font-medium` at the root so default-variant info notices
    // (e.g. PublishPage helper hints) don't get unexpectedly bold. Status variants
    // opt-in to `font-semibold` via the `[&_h5]:font-semibold` descendant selector
    // declared on `alertVariants` below.
    <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
  )
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
  )
)
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }

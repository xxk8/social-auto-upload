import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    // `<Slot>` (and `<Slottable>`) require exactly ONE React element child.
    // `loading && <Spinner/>` evaluates to `false`/`undefined` when `loading`
    // is not set — Radix still counts that as an extra child slot and throws
    // "Expected a single React element child or `Slottable`" (or now
    // "Slot failed to slot onto its `Slottable`" when the spinner was
    // wrapped in Slottable). Failure here shows up at the ErrorBoundary as
    // a "页面出错了" card instead of the marketing/dashboard content.
    //
    // Canonical shadcn-style fix: when `asChild=true`, render `{children}`
    // only. Spinner injection is suppressed on the asChild path; call sites
    // that need a loading-state indicator on an `asChild` button can render
    // their own spinner inside the wrapped child (Link / anchor / etc.).
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {children}
          </>
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button }
// Note: `buttonVariants` (the cva() recipe) is intentionally NOT re-exported.
// It stays a module-private detail of `<Button>` and exists for exactly one
// reason: a feature-local `cva()` clone forks from a recipe readers can't
// import or grep against — the failure mode this invariant prevents. Every
// top-level export of this file is now a React component, which satisfies
// `react-refresh/only-export-components`. (Mirrors the badge fix pattern
// documented in DESIGN-components.md `cross-cutting`.)

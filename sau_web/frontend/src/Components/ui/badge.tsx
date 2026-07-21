import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { toneChipClasses } from "@/lib/tone"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        // ============================================================
        // DESIGN.md — neutral (canonical)
        //   `secondary` is the default for bare `<Badge>...</Badge>`.
        //   The earlier "default" variant mapped to bg-primary and
        //   was removed so the single accent token stays reserved
        //   for brand mark / CTA / focus / link surfaces per the
        //   `Do's and Don'ts` section in DESIGN.md. Zero callers
        //   referenced `default` to begin with. Migration history
        //   lives in DESIGN.md — this file should not name legacy
        //   palette tokens in narrative comments.
        // ============================================================
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        // ============================================================
        // DESIGN.md (Linear) — semantic status palette from index.css,
        // composed via `@/lib/tone` so Badge / Alert / Toast / ChipBar
        // stay in sync from a single tonal vocabulary.
        // ============================================================
        success: cn("border-transparent", toneChipClasses("success")),
        warning: cn("border-transparent", toneChipClasses("warning")),
        info: cn("border-transparent", toneChipClasses("info")),
        error: cn("border-transparent", toneChipClasses("error")),
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }

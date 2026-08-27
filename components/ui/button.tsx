import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Hevet kontrollflate — se designlerretet «Knapper — systemet».
  // Dybden kommer fra tokens i globals.css (--shadow-raised, --control-sheen),
  // ikke fra farger her, slik at én endring der slår ut på hele appen.
  // `bg-blend-*` er bevisst utelatt: sheen-gradienten er gjennomsiktig, så en
  // knapp som får sin egen bakgrunn av kalleren beholder fargen sin.
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 active:translate-y-px disabled:pointer-events-none disabled:cursor-default disabled:bg-none disabled:opacity-50 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primær — én per skjerm.
        default:
          "border-primary bg-primary bg-[image:var(--control-sheen)] text-primary-foreground shadow-[var(--shadow-raised)] hover:bg-primary/95 hover:shadow-[var(--shadow-raised-hover)] active:shadow-[var(--shadow-pressed)]",
        // Sekundær — hvit, sidestilt valg.
        outline:
          "border-[color:var(--control-border-soft)] bg-background bg-[image:var(--control-sheen-soft)] text-foreground shadow-[var(--shadow-surface)] hover:bg-muted hover:shadow-[var(--shadow-surface-hover)] active:shadow-[var(--shadow-surface-pressed)] aria-expanded:bg-muted aria-expanded:shadow-[var(--shadow-surface-pressed)] dark:bg-input/30",
        secondary:
          "border-[color:var(--control-border-soft)] bg-secondary bg-[image:var(--control-sheen-soft)] text-secondary-foreground shadow-[var(--shadow-surface)] hover:bg-secondary/80 hover:shadow-[var(--shadow-surface-hover)] active:shadow-[var(--shadow-surface-pressed)] aria-expanded:shadow-[var(--shadow-surface-pressed)]",
        // Aksent — dagens handling (stemple inn, godkjenn). Ikke pynt.
        accent:
          "border-[color:color-mix(in_srgb,var(--accent)_78%,#151515)] bg-accent bg-[image:var(--control-sheen-soft)] text-accent-foreground shadow-[var(--shadow-surface)] hover:bg-accent/90 hover:shadow-[var(--shadow-surface-hover)] active:shadow-[var(--shadow-surface-pressed)]",
        // Stille — avvis uten vekt. Bevisst flat: ingen skygge, ingen kant.
        ghost:
          "bg-none shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // Fare — hvit bunn, rød skrift. Bekreftes alltid.
        destructive:
          "border-destructive/25 bg-background bg-[image:var(--control-sheen-soft)] text-destructive shadow-[var(--shadow-surface)] hover:bg-destructive/10 hover:shadow-[var(--shadow-surface-hover)] active:shadow-[var(--shadow-surface-pressed)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/15 dark:hover:bg-destructive/25 dark:focus-visible:ring-destructive/40",
        link: "bg-none text-primary underline-offset-4 shadow-none hover:underline active:translate-y-0",
      },
      size: {
        // Én skala, styrt av --control-h*-tokens i globals.css:
        // xs 24 < sm 30 < standard 34 < lg 40 < xl 52.
        // Explicit heights from callers (h-8/h-12/h-14 …) still win via
        // tailwind-merge, and @media (pointer: coarse) in globals.css floors
        // these to tappable sizes on touch.
        default:
          "h-[var(--control-h)] gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-[var(--control-h-xs)] gap-1 px-2 text-xs in-data-[slot=button-group]:rounded-none has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--control-h-sm)] gap-1 px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-none has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-[var(--control-h-lg)] gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        // xl: den store handlingen ute på plassen — treffbar med hansker.
        xl: "h-[var(--control-h-xl)] gap-2.5 rounded-[10px] px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5 [&_svg:not([class*='size-'])]:size-5",
        icon: "size-[var(--control-h)]",
        "icon-xs":
          "size-[var(--control-h-xs)] in-data-[slot=button-group]:rounded-none [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-[var(--control-h-sm)] in-data-[slot=button-group]:rounded-none",
        "icon-lg": "size-[var(--control-h-lg)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

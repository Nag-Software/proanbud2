"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"

/**
 * ResponsiveDialog renders a bottom-sheet Drawer on phones (native app feel,
 * swipe-to-dismiss, reachable thumb zone) and a centered Dialog on desktop.
 * Drop-in for Dialog: same sub-component names with the `ResponsiveDialog` prefix.
 * The footer automatically gets safe-area bottom padding on mobile.
 */

const MobileContext = React.createContext(false)
const useResponsiveIsMobile = () => React.useContext(MobileContext)

function ResponsiveDialog(
  props: React.ComponentProps<typeof Dialog> & React.ComponentProps<typeof Drawer>
) {
  const isMobile = useIsMobile()
  return (
    <MobileContext.Provider value={isMobile}>
      {isMobile ? <Drawer direction="bottom" {...props} /> : <Dialog {...props} />}
    </MobileContext.Provider>
  )
}

function ResponsiveDialogTrigger(props: React.ComponentProps<typeof DialogTrigger>) {
  const isMobile = useResponsiveIsMobile()
  return isMobile ? <DrawerTrigger {...props} /> : <DialogTrigger {...props} />
}

function ResponsiveDialogClose(props: React.ComponentProps<typeof DialogClose>) {
  const isMobile = useResponsiveIsMobile()
  return isMobile ? <DrawerClose {...props} /> : <DialogClose {...props} />
}

function ResponsiveDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const isMobile = useResponsiveIsMobile()
  if (isMobile) {
    return (
      <DrawerContent className={cn("max-h-[92vh]", className)}>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </DrawerContent>
    )
  }
  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  )
}

function ResponsiveDialogHeader(props: React.ComponentProps<typeof DialogHeader>) {
  const isMobile = useResponsiveIsMobile()
  return isMobile ? <DrawerHeader {...props} /> : <DialogHeader {...props} />
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const isMobile = useResponsiveIsMobile()
  if (isMobile) {
    return (
      <DrawerFooter
        className={cn("pb-[max(1rem,env(safe-area-inset-bottom))]", className)}
        {...props}
      />
    )
  }
  return <DialogFooter className={className} {...props} />
}

function ResponsiveDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  const isMobile = useResponsiveIsMobile()
  return isMobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />
}

function ResponsiveDialogDescription(
  props: React.ComponentProps<typeof DialogDescription>
) {
  const isMobile = useResponsiveIsMobile()
  return isMobile ? <DrawerDescription {...props} /> : <DialogDescription {...props} />
}

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
}

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PlusCircle, X } from "lucide-react"

import { NewOfferWizard } from "@/components/tilbud/new-offer-wizard"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { type OfferCompanyContext, type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

type NewOfferDrawerProps = {
  projects: OfferProjectOption[]
  customers: OfferCustomerOption[]
  company: OfferCompanyContext | null
  initialProjectId?: string
  defaultOpen?: boolean
}

export function NewOfferDrawer({ projects, customers, company, initialProjectId, defaultOpen = false }: NewOfferDrawerProps) {
  const router = useRouter()
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="right">
      <DrawerTrigger asChild>
        <Button className="flex h-auto flex-row gap-1 py-2 sm:w-[fit-content]" size="default">
          <PlusCircle className="h-4 w-4" />
          Nytt tilbud
        </Button>
      </DrawerTrigger>

      <DrawerContent className="w-full sm:w-screen! sm:max-w-7xl! border-l bg-background p-0">
        <DrawerHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle className="text-sm font-semibold">Nytt tilbud</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Lukk tilbudsskuff">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="h-[calc(100vh)] mx-auto w-full overflow-hidden">
          <NewOfferWizard
            projects={projects}
            customers={customers}
            company={company}
            initialProjectId={initialProjectId}
            onCompleted={() => {
              setOpen(false)
              router.refresh()
            }}
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

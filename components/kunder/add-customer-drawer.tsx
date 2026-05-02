"use client"

import * as React from "react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createCustomerAction } from "@/app/kunder/actions"
import { useRouter } from "next/navigation"

interface AddCustomerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (customer: { id: string; name: string }) => void
}

export function AddCustomerDrawer({ open, onOpenChange, onCreated }: AddCustomerDrawerProps) {
  const [type, setType] = React.useState<"privatperson" | "bedrift">("privatperson")
  const [isPending, setIsPending] = React.useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsPending(true)
    const formData = new FormData(e.currentTarget)
    
    try {
      // Append the type since it's in state and not necessarily a form input by default
      formData.append("type", type);
      
      const createdId = await createCustomerAction(formData)
      const createdName = (formData.get("name") as string) || ""

      onCreated?.({ id: createdId, name: createdName })
      router.refresh()
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to create customer:", error)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="flex flex-col p-0">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          <DrawerHeader className="pl-4 sm:pl-6 pr-12 pt-6 pb-4 border-b shrink-0 bg-background z-10">
            <DrawerTitle>Legg til ny kunde</DrawerTitle>
            <DrawerDescription>
              Fyll inn detaljene for å opprette en ny kunde.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-3 p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-2 w-full">
                  <Label htmlFor="type">Kundetype</Label>
                  <Select value={type} onValueChange={(val: "privatperson" | "bedrift") => setType(val)}>
                    <SelectTrigger id="type" className="w-full">
                      <SelectValue placeholder="Velg kundetype" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Velg kundetype</SelectLabel>
                        <SelectItem value="privatperson">Privatperson</SelectItem>
                        <SelectItem value="bedrift">Bedrift</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="name">
                    {type === "bedrift" ? "Bedriftsnavn *" : "Fullt navn *"}
                  </Label>
                  <Input id="name" name="name" required placeholder={type === "bedrift" ? "f.eks. Solheim Bygg AS" : "f.eks. Ola Nordmann"} />
                </div>

                {type === "bedrift" && (
                  <div className="grid gap-2">
                    <Label htmlFor="orgNumber">Organisasjonsnummer</Label>
                    <Input id="orgNumber" name="orgNumber" placeholder="9 sifre" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">E-post *</Label>
                  <Input id="email" name="email" type="email" required placeholder="ola@eksempel.no" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input id="phone" name="phone" type="tel" placeholder="+47 123 45 678" />
                </div>
              </div>

              <div className="grid gap-2 pt-2 border-t">
                <Label className="text-muted-foreground font-semibold mb-2 block">Adresse</Label>
                <Label htmlFor="address">Gateadresse</Label>
                <Input id="address" name="address" placeholder="Storgata 1" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2 col-span-1">
                  <Label htmlFor="postalCode">Postnr</Label>
                  <Input id="postalCode" name="postalCode" placeholder="0101" />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label htmlFor="city">Poststed</Label>
                  <Input id="city" name="city" placeholder="Oslo" />
                </div>
              </div>

              <div className="grid gap-2 pt-2 border-t">
                <Label htmlFor="notes">Notater</Label>
                <Textarea id="notes" name="notes" placeholder="Tilleggsinformasjon om kunden..." />
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6 border-t shrink-0 flex justify-end gap-3 bg-background mt-auto">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Avbryt</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Lagrer..." : "Lagre kunde"}</Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
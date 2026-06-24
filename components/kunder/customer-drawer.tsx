"use client"

import * as React from "react"
import { Customer } from "./schema"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, User, Phone, Mail, MapPin, Briefcase, TrendingUp, Clock, FileCheck } from "lucide-react"
import { updateCustomerAction } from "@/app/kunder/actions"
import { toast } from "sonner"
import { CustomerProjectsTab } from "./customer-projects-tab"

interface CustomerDrawerProps {
  customer: Customer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: (customer: Customer) => void
}

export function CustomerDrawer({ customer, open, onOpenChange, onUpdate }: CustomerDrawerProps) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editType, setEditType] = React.useState<"privatperson" | "bedrift">("privatperson")
  const [isSaving, startTransition] = React.useTransition()

  // Reset editing state when drawer closes or customer changes
  React.useEffect(() => {
    if (!open) {
      setIsEditing(false)
    }
    if (customer) {
      setEditType(customer.type)
    }
  }, [open, customer])

  if (!customer) return null

  const isBusiness = customer.type === "bedrift"

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    const type = formData.get("type") as "privatperson" | "bedrift"
    const nextCustomer = {
      ...customer,
      type,
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      phone: formData.get("phone") as string,
      orgNumber: type === "bedrift" ? (formData.get("orgNumber") as string) : undefined,
      address: formData.get("address") as string,
      postalCode: formData.get("postalCode") as string,
      city: formData.get("city") as string,
    }

    startTransition(async () => {
      try {
        await updateCustomerAction({
          id: customer.id,
          type,
          name: nextCustomer.name,
          email: nextCustomer.email,
          phone: nextCustomer.phone,
          orgNumber: nextCustomer.orgNumber,
          address: nextCustomer.address,
          postalCode: nextCustomer.postalCode,
          city: nextCustomer.city,
        })

        onUpdate?.(nextCustomer)
        setIsEditing(false)
        toast.success("Kunden ble oppdatert")
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kunne ikke lagre kunde"
        toast.error(message)
      }
    })
  }

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="flex w-full flex-col p-0 sm:max-w-lg md:max-w-2xl">
        <DrawerHeader className="pl-4 sm:pl-6 pr-12 py-6 border-b shrink-0 bg-background z-10">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-full flex items-center justify-center">
                {isBusiness ? <Building2 className="w-6 h-6 text-primary" /> : <User className="w-6 h-6 text-primary" />}
              </div>
              <div className="flex flex-col">
                <DrawerTitle className="text-xl md:text-2xl leading-none">{customer.name}</DrawerTitle>
                <DrawerDescription className="flex items-center gap-2 mt-1.5">
                  <Badge variant={isBusiness ? "default" : "secondary"} className="text-xs font-normal">
                    {isBusiness ? "Bedrift" : "Privatperson"}
                  </Badge>
                  {isBusiness && customer.orgNumber && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Org: {customer.orgNumber}</span>
                  )}
                </DrawerDescription>
              </div>
            </div>
            {!isEditing && (
              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>Rediger</Button>
            )}
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 pb-12">
          {isEditing ? (
            <form id="edit-customer-form" onSubmit={handleSave} className="grid gap-6">
              <input type="hidden" name="type" value={editType} />
              
              <div className="grid gap-2">
                <Label>Kundetype</Label>
                <Select value={editType} onValueChange={(val: "privatperson" | "bedrift") => setEditType(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="privatperson">Privatperson</SelectItem>
                    <SelectItem value="bedrift">Bedrift</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-name">
                  {editType === "bedrift" ? "Bedriftsnavn *" : "Fullt navn *"}
                </Label>
                <Input id="edit-name" name="name" defaultValue={customer.name} required />
              </div>

              {editType === "bedrift" && (
                <div className="grid gap-2">
                  <Label htmlFor="edit-orgNumber">Organisasjonsnummer</Label>
                  <Input id="edit-orgNumber" name="orgNumber" defaultValue={customer.orgNumber} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-email">E-post *</Label>
                  <Input id="edit-email" name="email" type="email" defaultValue={customer.email} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-phone">Telefon</Label>
                  <Input id="edit-phone" name="phone" type="tel" defaultValue={customer.phone} />
                </div>
              </div>

              <div className="grid gap-2 pt-2 border-t">
                <Label className="text-muted-foreground font-semibold mb-2 block">Adresse</Label>
                <Label htmlFor="edit-address">Gateadresse</Label>
                <Input id="edit-address" name="address" defaultValue={customer.address} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2 col-span-1">
                  <Label htmlFor="edit-postalCode">Postnr</Label>
                  <Input id="edit-postalCode" name="postalCode" defaultValue={customer.postalCode} />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label htmlFor="edit-city">Poststed</Label>
                  <Input id="edit-city" name="city" defaultValue={customer.city} />
                </div>
              </div>

            </form>
          ) : (
            <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="overview">Oversikt</TabsTrigger>
              <TabsTrigger value="projects">Prosjekter</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Left Column: Contact & Notes */}
                <div className="space-y-4">
                  <Card className="shadow-sm">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" /> Kontaktinfo
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-2 space-y-3">
                      <div className="flex items-center gap-3 text-sm">
                        <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{customer.email}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span>{customer.phone}</span>
                      </div>
                      
                      <div className="flex items-start gap-3 text-sm pt-2 mt-2 border-t">
                        <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="leading-tight text-muted-foreground">
                          <div className="text-foreground">{customer.address}</div>
                          <div>{customer.postalCode} {customer.city}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" /> Aktivitet & Notater
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-2">
                      <div className="text-xs text-muted-foreground mb-3 flex items-center justify-between">
                        <span>Sist kontaktet:</span>
                        <span className="font-medium text-foreground">—</span>
                      </div>
                      <div className="bg-muted/50 rounded-md p-3 text-sm border-l-2 border-primary/50 text-muted-foreground italic">
                        Ingen notater enda.
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Column: Statistics */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card className="shadow-sm">
                      <CardContent className="p-4 flex flex-col justify-center gap-1">
                        <span className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                          <Briefcase className="h-3 w-3" /> Prosjekter
                        </span>
                        <span className="text-2xl font-bold tracking-tight">{customer.totalProjects}</span>
                        <span className="text-xs text-muted-foreground">
                          {customer.activeProjects} aktive
                        </span>
                      </CardContent>
                    </Card>
                    <Card className="shadow-sm">
                      <CardContent className="p-4 flex flex-col justify-center gap-1">
                        <span className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                          <FileCheck className="h-3 w-3" /> Akseptert
                        </span>
                        <span className="text-2xl font-bold tracking-tight">
                          {customer.acceptanceRate ?? 0}{" "}
                          <span className="text-sm font-normal text-muted-foreground">%</span>
                        </span>
                        <span className="text-xs text-muted-foreground">Av sendte tilbud</span>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="shadow-sm border-primary/20">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-semibold flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-emerald-500" /> Total omsetning
                        </span>
                      </div>
                      <div className="text-3xl font-bold">
                        {new Intl.NumberFormat("nb-NO", {
                          style: "currency",
                          currency: "NOK",
                          maximumFractionDigits: 0,
                        }).format(customer.totalRevenue)}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Sum aksepterte tilbud</p>
                    </CardContent>
                  </Card>
                </div>

              </div>
            </TabsContent>
          
          <TabsContent value="projects">
            <CustomerProjectsTab
              customerId={customer.id}
              projects={customer.projects || []}
            />
          </TabsContent>
        </Tabs>
          )}
        </div>
        
        {isEditing && (
          <div className="p-4 sm:p-6 border-t shrink-0 flex justify-end gap-3 bg-background mt-auto">
            <Button type="button" variant="outline" onClick={() => setIsEditing(false)} disabled={isSaving}>Avbryt</Button>
            <Button type="submit" form="edit-customer-form" disabled={isSaving}>Lagre endringer</Button>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}
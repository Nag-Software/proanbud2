"use client"

import * as React from "react"
import { Customer } from "./schema"
import { createCustomerColumns } from "./columns"
import { DataTable } from "./data-table"
import { CustomerDrawer } from "./customer-drawer"
import { AddCustomerDrawer } from "./add-customer-drawer"
import { Button } from "@/components/ui/button"
import { PlusCircle, Users, Building2, User } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface KunderClientProps {
  initialData: Customer[]
  tripletexEnabled?: boolean
}

export function KunderClient({ initialData, tripletexEnabled = false }: KunderClientProps) {
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null)
  const [isCustomerDrawerOpen, setIsCustomerDrawerOpen] = React.useState(false)
  const [isAddDrawerOpen, setIsAddDrawerOpen] = React.useState(false)

  // We use initialData directly so the UI always exactly matches the database
  const data = initialData;

  const handleRowClick = React.useCallback((customer: Customer) => {
    setSelectedCustomer(customer)
    setIsCustomerDrawerOpen(true)
  }, [])

  const columns = React.useMemo(
    () => createCustomerColumns({ onViewDetails: handleRowClick, showTripletex: tripletexEnabled }),
    [handleRowClick, tripletexEnabled]
  )

  // Handle local update so the open drawer reflects changes immediately
  const handleUpdateCustomer = (updatedCustomer: Customer) => {
    setSelectedCustomer(updatedCustomer)
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Dine kunder
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Kundeoversikt
          </h1>
        </div>
        <div className="flex w-full sm:w-auto items-center">
          <Button className="w-full sm:w-auto" size="default" onClick={() => setIsAddDrawerOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Ny kunde
          </Button>
        </div>
      </div>

      
      <div>
        <DataTable columns={columns} data={data} onRowClick={handleRowClick} />
      </div>

      <CustomerDrawer 
        customer={selectedCustomer} 
        open={isCustomerDrawerOpen} 
        onOpenChange={setIsCustomerDrawerOpen} 
        onUpdate={handleUpdateCustomer}
      />

      <AddCustomerDrawer 
        open={isAddDrawerOpen} 
        onOpenChange={setIsAddDrawerOpen} 
      />
    </>
  )
}

"use client"

import * as React from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  BellIcon,
  MenuIcon,
  HomeIcon,
  PaintbrushIcon,
  MessageCircleIcon,
  GlobeIcon,
  KeyboardIcon,
  CheckIcon,
  VideoIcon,
  LinkIcon,
  LockIcon,
  SettingsIcon,
} from "lucide-react"
import type {
  QuotaSettingsField,
  QuotaSettingsFieldValue,
  QuotaSettingsSection,
} from "@/lib/types"

type SettingsDialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  settings?: QuotaSettingsSection[]
  activeSection?: string
  triggerLabel?: string
  onSave?: (values: Record<string, QuotaSettingsFieldValue>) => void
  isSaving?: boolean
}

const defaultSettings: QuotaSettingsSection[] = [
  { name: "Notifications", icon: "bell" },
  { name: "Navigation", icon: "menu" },
  { name: "Home", icon: "home" },
  { name: "Appearance", icon: "paintbrush" },
  { name: "Messages & media", icon: "message-circle" },
  { name: "Language & region", icon: "globe" },
  { name: "Accessibility", icon: "keyboard" },
  { name: "Mark as read", icon: "check" },
  { name: "Audio & video", icon: "video" },
  { name: "Connected accounts", icon: "link" },
  { name: "Privacy & visibility", icon: "lock" },
  { name: "Advanced", icon: "settings" },
]

const iconMap = {
  bell: BellIcon,
  menu: MenuIcon,
  home: HomeIcon,
  paintbrush: PaintbrushIcon,
  "message-circle": MessageCircleIcon,
  globe: GlobeIcon,
  keyboard: KeyboardIcon,
  check: CheckIcon,
  video: VideoIcon,
  link: LinkIcon,
  lock: LockIcon,
  settings: SettingsIcon,
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  activeSection,
  triggerLabel,
  onSave,
  isSaving,
}: SettingsDialogProps) {
  const resolvedSettings = React.useMemo(
    () => (settings?.length ? settings : defaultSettings),
    [settings]
  )
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(true)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : uncontrolledOpen
  const handleOpenChange = onOpenChange ?? setUncontrolledOpen
  const [currentSection, setCurrentSection] = React.useState(
    activeSection ?? resolvedSettings[0]?.name ?? "Settings"
  )
  const initialValues = React.useMemo(() => {
    const nextValues: Record<string, QuotaSettingsFieldValue> = {}
    resolvedSettings.forEach((section) => {
      section.fields?.forEach((field) => {
        nextValues[field.id] = field.value
      })
    })
    return nextValues
  }, [resolvedSettings])
  const [values, setValues] = React.useState(initialValues)

  React.useEffect(() => {
    if (activeSection) {
      setCurrentSection(activeSection)
    }
  }, [activeSection])

  React.useEffect(() => {
    if (!resolvedSettings.length) return
    const isValid = resolvedSettings.some(
      (section) => section.name === currentSection
    )
    if (!isValid) {
      setCurrentSection(resolvedSettings[0].name)
    }
  }, [resolvedSettings, currentSection])

  React.useEffect(() => {
    setValues(initialValues)
  }, [initialValues])

  const renderIcon = (iconKey?: string) => {
    if (!iconKey) return null
    const Icon = iconMap[iconKey as keyof typeof iconMap]
    return Icon ? <Icon className="size-4" /> : null
  }

  const handleValueChange = (fieldId: string, nextValue: QuotaSettingsFieldValue) => {
    setValues((prev) => ({ ...prev, [fieldId]: nextValue }))
  }

  const currentSettings = resolvedSettings.find(
    (section) => section.name === currentSection
  )

  const renderField = (field: QuotaSettingsField) => {
    const value = values[field.id]

    if (field.type === "text") {
      return (
        <Input
          id={field.id}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(event) => handleValueChange(field.id, event.target.value)}
        />
      )
    }

    if (field.type === "textfield") {
      return (
        <Textarea
          id={field.id}
          rows={4}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(event) => handleValueChange(field.id, event.target.value)}
        />
      )
    }

    if (field.type === "int") {
      return (
        <Input
          id={field.id}
          type="number"
          inputMode="numeric"
          value={typeof value === "number" ? value : ""}
          onChange={(event) => {
            const nextValue = event.target.value
            handleValueChange(
              field.id,
              nextValue === "" ? "" : Number(nextValue)
            )
          }}
        />
      )
    }

    if (field.type === "select") {
      const options = field.options ?? []
      const selectedOption = options.find((option) => option.value === value)

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={field.id}
              type="button"
              variant="outline"
              className="justify-between"
            >
              {selectedOption?.label ?? "Velg"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            {options.length ? (
              options.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => handleValueChange(field.id, option.value)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>Ingen valg</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    if (field.type === "toggle") {
      const isOn = Boolean(value)

      return (
        <Button
          id={field.id}
          type="button"
          variant={isOn ? "default" : "outline"}
          aria-pressed={isOn}
          className="w-fit"
          onClick={() => handleValueChange(field.id, !isOn)}
        >
          {isOn ? "Pa" : "Av"}
        </Button>
      )
    }

    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg" variant="outline" className="mb-6 text-black">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
        <DialogTitle className="sr-only">Innstillinger</DialogTitle>
        <DialogDescription className="sr-only">
          Tilpass innstillingene dine her.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel className="py-2">Prosjektinnstillinger </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {resolvedSettings.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.name === currentSection}
                        >
                          <button
                            type="button"
                            onClick={() => setCurrentSection(item.name)}
                          >
                            {renderIcon(item.icon)}
                            <span>{item.name}</span>
                          </button>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[480px] p-0 m-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 flex-col gap-2 border-b md:border-b-0">
              <div className="px-4 pt-3 md:hidden">
                <Select value={currentSection} onValueChange={setCurrentSection}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Velg seksjon" />
                  </SelectTrigger>
                  <SelectContent>
                    {resolvedSettings.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Innstillinger</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{currentSection}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </div>
            </header>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
              {currentSettings?.fields?.length ? (
                <div
                  className="grid gap-4"
                  style={
                    currentSettings.gridColNum
                      ? {
                          gridTemplateColumns: `repeat(${currentSettings.gridColNum}, minmax(0, 1fr))`,
                        }
                      : undefined
                  }
                >
                  {currentSettings.fields.map((field) => (
                    <div key={field.id} className="grid gap-2">
                      <Label htmlFor={field.id}>{field.label}</Label>
                      {renderField(field)}
                      {field.description ? (
                        <p className="text-xs text-muted-foreground">
                          {field.description}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Ingen felter definert for denne seksjonen.
                </div>
              )}
            </div>
            {onSave && (
              <div className="flex justify-end px-5">
                <Button disabled={isSaving} onClick={() => onSave(values)} className="h-9">
                  {isSaving ? "Lagrer..." : "Lagre endringer"}
                </Button>
              </div>
            )}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

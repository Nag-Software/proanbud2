"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { canManageSubscription } from "@/lib/roles"
import { reportClientError } from "@/lib/errors/client"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import {
  BadgeCheckIcon,
  Building2Icon,
  ChevronsUpDownIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  Loader2Icon,
  LogOutIcon,
  ShieldCheckIcon,
  UserIcon,
} from "lucide-react"

type UserProfileState = {
  full_name: string
  avatar_url: string
  email: string
  role: string
  company_id: string | null
  company_name: string
  company_org_number: string
  bio: string
}

export function NavUser() {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfileState | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editAvatar, setEditAvatar] = useState("")
  const [editBio, setEditBio] = useState("")
  const [editCompanyName, setEditCompanyName] = useState("")
  const [editCompanyOrgNumber, setEditCompanyOrgNumber] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? ""

  useEffect(() => {
    async function fetchUser() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setIsLoading(false)
        return
      }
      setUser(session.user)

      const { data: userRow } = await supabase
        .from("users")
        .select("full_name, email, role, company_id")
        .eq("id", session.user.id)
        .maybeSingle()

      const { data: companyRow } = userRow?.company_id
        ? await supabase
            .from("companies")
            .select("name, org_number")
            .eq("id", userRow.company_id)
            .maybeSingle()
        : { data: null }

      const { data: profileData } = await supabase
        .from("user_profiles")
        .select("avatar_url, bio")
        .eq("user_id", session.user.id)
        .maybeSingle()

      const nextProfile: UserProfileState = {
        full_name: userRow?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || "",
        avatar_url:
          profileData?.avatar_url ||
          session.user.user_metadata?.avatar_url ||
          session.user.user_metadata?.picture ||
          "",
        email: userRow?.email || session.user.email || "",
        role: userRow?.role || "worker",
        company_id: userRow?.company_id || null,
        company_name: companyRow?.name || "",
        company_org_number: companyRow?.org_number || "",
        bio: profileData?.bio || "",
      }

      if (profileData) {
        setProfile(nextProfile)
      } else {
        const newProfile = { user_id: session.user.id, avatar_url: nextProfile.avatar_url, bio: "" }
        await supabase.from("user_profiles").upsert(newProfile)
        setProfile(nextProfile)
      }

      setEditName(nextProfile.full_name)
      setEditAvatar(nextProfile.avatar_url)
      setEditBio(nextProfile.bio)
      setEditCompanyName(nextProfile.company_name)
      setEditCompanyOrgNumber(nextProfile.company_org_number)

      setIsLoading(false)
    }

    fetchUser()
  }, [supabase])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  const handleManageSubscription = () => {
    router.push("/innstillinger/betaling")
  }

  const saveProfile = async () => {
    if (!user || !profile) return
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from("users")
        .update({
          full_name: editName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      if (error) {
        throw error
      }

      if (profile.company_id) {
        const { error: companyError } = await supabase
          .from("companies")
          .update({
            name: editCompanyName.trim(),
            org_number: editCompanyOrgNumber.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", profile.company_id)

        if (companyError) {
          throw companyError
        }
      }

      const { error: profileError } = await supabase
        .from("user_profiles")
        .upsert({
          user_id: user.id,
          avatar_url: editAvatar.trim(),
          bio: editBio.trim(),
          updated_at: new Date().toISOString(),
        })

      if (profileError) {
        throw profileError
      }

      const nextProfile: UserProfileState = {
        ...profile,
        full_name: editName.trim(),
        avatar_url: editAvatar.trim(),
        bio: editBio.trim(),
        company_name: editCompanyName.trim(),
        company_org_number: editCompanyOrgNumber.trim(),
      }

      setProfile(nextProfile)
      setIsSettingsOpen(false)
      toast.success("Kontoinnstillingene er lagret.")
      router.refresh()
    } catch (error) {
      console.error("Error saving profile", error)
      reportClientError(error, { context: { action: "save-profile", userId: user.id } })
      toast.error("Kunne ikke lagre innstillingene.")
    } finally {
      setIsSaving(false)
    }
  }

  const roleLabel = {
    admin: "Admin",
    manager: "Leder",
    worker: "Bruker",
  } as const

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="justify-center">
            <Loader2Icon className="h-4 w-4 animate-spin" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  if (!user) {
    return null
  }

  const displayName = profile?.full_name || user.email?.split("@")[0] || "Bruker"
  const displayEmail = profile?.email || user.email || ""
  const avatarUrl = profile?.avatar_url || ""
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "PR"
  const subscriptionConfigured = Boolean(stripePublishableKey)
  const canManageBilling = canManageSubscription(profile?.role)
  const currentRole = profile?.role && profile.role in roleLabel
    ? roleLabel[profile.role as keyof typeof roleLabel]
    : "Bruker"
  const companyName = profile?.company_name?.trim() || "Ikke satt"
  const companyOrgNumber = profile?.company_org_number?.trim() || "Ikke satt"
  const bioPreview = profile?.bio?.trim() || "Ingen kort beskrivelse lagt til ennå."
  const hasChanges =
    editName.trim() !== (profile?.full_name || "") ||
    editAvatar.trim() !== (profile?.avatar_url || "") ||
    editBio.trim() !== (profile?.bio || "") ||
    editCompanyName.trim() !== (profile?.company_name || "") ||
    editCompanyOrgNumber.trim() !== (profile?.company_org_number || "")
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                  <span className="truncate text-xs">{displayEmail}</span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={avatarUrl} alt={displayName} />
                    <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{displayName}</span>
                    <span className="truncate text-xs">{displayEmail}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setIsSettingsOpen(true)}>
                  <BadgeCheckIcon className="mr-2 h-4 w-4" />
                  Min Konto
                </DropdownMenuItem>
                {canManageBilling && (
                  <DropdownMenuItem onClick={handleManageSubscription}>
                    <CreditCardIcon className="mr-2 h-4 w-4" />
                    Abonnement
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOutIcon className="mr-2 h-4 w-4" />
                Logg ut
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Drawer direction="right" open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DrawerContent className="flex w-full flex-col">
          <DrawerHeader>
            <DrawerTitle>Min Konto</DrawerTitle>
            <DrawerDescription>
              Oppdater de viktigste bruker- og bedriftsinnstillingene for Proanbud-kontoen din.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="space-y-5">
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={avatarUrl} alt={displayName} />
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="space-y-2">
                      <CardTitle className="text-xl">{displayName}</CardTitle>
                      <CardDescription>{displayEmail}</CardDescription>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{currentRole}</Badge>
                        <Badge variant="outline">{companyName}</Badge>
                        <Badge variant={subscriptionConfigured ? "secondary" : "destructive"}>
                          {subscriptionConfigured ? "Godkjent" : "Mangler abonnement"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>{bioPreview}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Firma</p>
                      <p className="font-medium text-foreground">{companyName}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Org.nr.</p>
                      <p className="font-medium text-foreground">{companyOrgNumber}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserIcon className="h-4 w-4" />
                    Profil
                  </CardTitle>
                  <CardDescription>
                    Dette er det andre i Proanbud ser når de samarbeider med deg.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="email">E-post</Label>
                      <Input id="email" value={displayEmail} disabled className="bg-muted" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Tilgangsnivå</Label>
                      <Input id="role" value={currentRole} disabled className="bg-muted" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fullName">Fullt navn</Label>
                    <Input
                      id="fullName"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      placeholder="Eks. Ola Nordmann"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="avatarUrl">Avatar-lenke</Label>
                    <Input
                      id="avatarUrl"
                      value={editAvatar}
                      onChange={(event) => setEditAvatar(event.target.value)}
                      placeholder="https://..."
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <DrawerFooter className="mt-auto border-t">
            <DrawerClose asChild>
              <Button variant="outline">Avbryt</Button>
            </DrawerClose>
            <Button onClick={saveProfile} disabled={isSaving || !hasChanges}>
              {isSaving ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : null}
              Lagre endringer
            </Button>
            <Button type="button" variant="outline" className="w-full font-bold text-red-700 hover:text-red-bolder border-red-600 justify-center" onClick={handleLogout}>
                Logg ut av Proanbud
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}

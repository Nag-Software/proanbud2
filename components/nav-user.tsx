"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
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
import { Button } from "@/components/ui/button"

import { ChevronsUpDownIcon, BadgeCheckIcon, LogOutIcon, Loader2Icon } from "lucide-react"

export function NavUser() {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editAvatar, setEditAvatar] = useState("")
  const [isSaving, setIsSaving] = useState(false)

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
        .select("full_name, email")
        .eq("id", session.user.id)
        .maybeSingle()

      const { data: profileData } = await supabase
        .from("user_profiles")
        .select("avatar_url")
        .eq("user_id", session.user.id)
        .maybeSingle()

      if (profileData) {
        setProfile({
          full_name: userRow?.full_name || session.user.user_metadata?.full_name || "",
          avatar_url: profileData.avatar_url || "",
          email: userRow?.email || session.user.email || "",
        })
        setEditName(userRow?.full_name || session.user.user_metadata?.full_name || "")
        setEditAvatar(profileData.avatar_url || "")
      } else {
        // Create empty profile metadata row.
        const newProfile = { user_id: session.user.id, avatar_url: "" }
        await supabase.from("user_profiles").upsert(newProfile)
        setProfile({
          full_name: userRow?.full_name || session.user.user_metadata?.full_name || "",
          avatar_url: "",
          email: userRow?.email || session.user.email || "",
        })
      }

      setIsLoading(false)
    }

    fetchUser()
  }, [supabase])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  const saveProfile = async () => {
    if (!user) return
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from("users")
        .update({
          full_name: editName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
      
      if (!error) {
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, avatar_url: editAvatar, updated_at: new Date().toISOString() })

        setProfile({ ...profile, full_name: editName, avatar_url: editAvatar })
        setIsSettingsOpen(false)
      }
    } catch (error) {
      console.error("Error saving profile", error)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="justify-center">
            <Loader2Icon className="animate-spin h-4 w-4" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  if (!user) {
    return null
  }

  const displayName = profile?.full_name || user.email?.split("@")[0] || "Bruker"
  const displayEmail = user.email || ""
  const avatarUrl = profile?.avatar_url || ""
  const initials = displayName.substring(0, 2).toUpperCase()

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
        <DrawerContent className="flex flex-col w-full">
          <DrawerHeader>
            <DrawerTitle>Min Konto</DrawerTitle>
            <DrawerDescription>
              Oppdater profilen din her. Endringer lagres automatisk når du trykker lagre.
            </DrawerDescription>
          </DrawerHeader>
          
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="space-y-6">
            <div className="flex flex-row space-x-6">
              <div className="space-y-2 w-full">
                <Label htmlFor="email">E-post (kan ikke endres)</Label>
                <Input id="email" value={displayEmail} disabled className="bg-muted" />
              </div>
              
              <div className="space-y-2 w-full">
                <Label htmlFor="fullName">Fullt navn</Label>
                <Input 
                  id="fullName" 
                  value={editName} 
                  onChange={(e) => setEditName(e.target.value)} 
                  placeholder="eks. Ola Nordmann"
                />
              </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="avatarUrl">Avatar-lenke (bilde)</Label>
                <Input 
                  id="avatarUrl" 
                  value={editAvatar} 
                  onChange={(e) => setEditAvatar(e.target.value)} 
                  placeholder="https://..."
                />
                {editAvatar && (
                  <div className="mt-4 flex items-center gap-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={editAvatar} alt="Forhåndsvisning" />
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">Forhåndsvisning</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DrawerFooter className="mt-auto border-t">
            <DrawerClose asChild>
              <Button variant="outline">Avbryt</Button>
            </DrawerClose>
            <Button onClick={saveProfile} disabled={isSaving}>
              {isSaving && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              Lagre endringer
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}

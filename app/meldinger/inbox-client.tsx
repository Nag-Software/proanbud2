"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { cn, generateLocalId } from "@/lib/utils";
import { reportClientError } from "@/lib/errors/client";
import { useUserRole } from "@/hooks/use-user-role";
import {
  buildConversations,
  countFilters,
  defaultReplyOfferId,
  filterConversations,
  isUnread,
  messageableOffers,
  type InboxCustomer,
  type InboxFilter,
  type InboxMessage,
  type InboxOffer,
  type InboxProject,
} from "@/lib/meldinger/inbox";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ConversationDetails } from "./context-panel";
import { NewConversationDialog } from "./new-conversation-dialog";

interface InboxClientProps {
  companyId: string;
  currentUserId: string;
  initialCustomerId?: string | null;
}

/**
 * `messages` ligger ikke i supabase_realtime-publikasjonen, så innboksen er
 * ikke live. I stedet hentes alt på nytt når fanen/appen får fokus igjen (maks
 * én gang per dette intervallet) og når man trykker «Hent nye meldinger».
 * Ingen polling i bakgrunnen — databasen er på et lite compute-nivå.
 */
const FOCUS_REFRESH_MIN_MS = 30_000;

export default function InboxClient({ companyId, currentUserId, initialCustomerId }: InboxClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const { hasFeature } = useUserRole();
  const canUseAi = hasFeature("meldinger_ki");

  const [customers, setCustomers] = useState<InboxCustomer[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [offers, setOffers] = useState<InboxOffer[]>([]);
  const [projects, setProjects] = useState<InboxProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [query, setQuery] = useState("");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Kunder man har startet en samtale med, men ikke sendt noe til ennå. */
  const [startedCustomerIds, setStartedCustomerIds] = useState<string[]>([]);
  /** Tilbud valgt manuelt i svarfeltet, per kunde. */
  const [replyOfferChoice, setReplyOfferChoice] = useState<Record<string, string>>({});
  const draftsRef = useRef(new Map<string, string>());
  const lastLoadRef = useRef(0);
  const loadingRef = useRef(false);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (mode === "refresh") setIsRefreshing(true);
      try {
        const [customersRes, messagesRes, offersRes] = await Promise.all([
          supabase
            .from("customers")
            .select("id, name, email, phone, address, postal_code, city")
            .eq("company_id", companyId),
          supabase
            .from("messages")
            .select("*")
            .eq("company_id", companyId)
            // Nyeste først med grense, snudd under: stigende uten grense kuttet de NYESTE
            // meldingene når bedriften passerte PostgRESTs standardgrense på 1000 rader.
            .order("created_at", { ascending: false })
            .limit(1000),
          supabase
            .from("offers")
            .select(
              "id, customer_id, project_id, title, status, amount_nok, sent_at, customer_viewed_at, accepted_at, recipient_email, created_at"
            )
            .eq("company_id", companyId)
            .neq("status", "draft"),
        ]);

        const results = [
          [customersRes.error, "Hent kunder i meldinger"],
          [messagesRes.error, "Hent meldinger"],
          [offersRes.error, "Hent tilbud i meldinger"],
        ] as const;
        for (const [error, action] of results) {
          if (error) reportClientError(error, { context: { action, companyId } });
        }
        if (results.some(([error]) => error)) {
          toast.error("Kunne ikke hente alle meldingene", { description: "Prøv «Hent nye meldinger» om litt." });
        }

        if (customersRes.data) setCustomers(customersRes.data as InboxCustomer[]);
        if (messagesRes.data) setMessages([...(messagesRes.data as InboxMessage[])].reverse());
        if (offersRes.data) {
          const offerRows = offersRes.data as InboxOffer[];
          setOffers(offerRows);
          const projectIds = [
            ...new Set(offerRows.map((o) => o.project_id).filter((id): id is string => Boolean(id))),
          ];
          if (projectIds.length > 0) {
            const { data, error } = await supabase.from("projects").select("id, name, status").in("id", projectIds);
            if (error) {
              reportClientError(error, { level: "warning", context: { action: "Hent prosjekter i meldinger", companyId } });
            }
            if (data) setProjects(data as InboxProject[]);
          }
        }
      } catch (err) {
        reportClientError(err, { context: { action: "Hent meldinger", companyId } });
        toast.error("Kunne ikke hente meldingene", { description: "Sjekk nettet og prøv igjen." });
      } finally {
        lastLoadRef.current = Date.now();
        loadingRef.current = false;
        setNow(new Date());
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [companyId, supabase]
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  // Hent på nytt når man kommer tilbake til fanen eller appen.
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadRef.current < FOCUS_REFRESH_MIN_MS) return;
      void load("refresh");
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [load]);

  // «I dag»/«i går» skal stemme også om siden står åpen over midnatt.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const markThreadAsRead = useCallback(
    async (customerId: string, unreadIds: string[]) => {
      const readAt = new Date().toISOString();
      const ids = new Set(unreadIds);
      setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, read_at: readAt } : m)));
      const { error } = await supabase.from("messages").update({ read_at: readAt }).in("id", unreadIds);
      if (error) {
        reportClientError(error, { level: "warning", context: { action: "Marker meldinger som lest", customerId } });
        setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, read_at: null } : m)));
      }
    },
    [supabase]
  );

  const thread = useMemo(
    () => (selectedCustomerId ? messages.filter((m) => m.customer_id === selectedCustomerId) : []),
    [messages, selectedCustomerId]
  );

  // Åpen samtale = lest. Gjelder også meldinger som kommer inn ved oppdatering.
  useEffect(() => {
    if (!selectedCustomerId) return;
    const unreadIds = thread.filter(isUnread).map((m) => m.id);
    if (unreadIds.length > 0) void markThreadAsRead(selectedCustomerId, unreadIds);
  }, [selectedCustomerId, thread, markThreadAsRead]);

  // Dyplenke ?kunde=<id> (fra varslene). Reagerer også når lenken endres mens
  // siden står åpen.
  const appliedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || !initialCustomerId || appliedDeepLinkRef.current === initialCustomerId) return;
    if (!customers.some((c) => c.id === initialCustomerId)) return;
    appliedDeepLinkRef.current = initialCustomerId;
    setSelectedCustomerId(initialCustomerId);
  }, [initialCustomerId, isLoading, customers]);

  const conversations = useMemo(
    () => buildConversations(customers, messages, offers, startedCustomerIds),
    [customers, messages, offers, startedCustomerIds]
  );
  const visibleConversations = useMemo(
    () => filterConversations(conversations, filter, query),
    [conversations, filter, query]
  );
  const counts = useMemo(() => countFilters(conversations), [conversations]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null;
  const customerOffers = useMemo(
    () => (selectedCustomerId ? messageableOffers(offers, selectedCustomerId) : []),
    [offers, selectedCustomerId]
  );
  const replyOfferId = useMemo(() => {
    if (!selectedCustomerId) return null;
    const chosen = replyOfferChoice[selectedCustomerId];
    if (chosen && customerOffers.some((o) => o.id === chosen)) return chosen;
    return defaultReplyOfferId(thread, offers, selectedCustomerId);
  }, [selectedCustomerId, replyOfferChoice, customerOffers, thread, offers]);
  const replyOffer = offers.find((o) => o.id === replyOfferId) ?? null;
  const project = replyOffer?.project_id ? (projects.find((p) => p.id === replyOffer.project_id) ?? null) : null;

  const handleSelect = useCallback((customerId: string) => {
    setSelectedCustomerId(customerId);
    setDetailsOpen(false);
  }, []);

  const handlePickNew = useCallback(
    (customerId: string) => {
      setNewDialogOpen(false);
      setStartedCustomerIds((prev) => (prev.includes(customerId) ? prev : [...prev, customerId]));
      // Samtalen skal synes selv om et filter eller søk ellers ville skjult den.
      setFilter("all");
      setQuery("");
      handleSelect(customerId);
    },
    [handleSelect]
  );

  const handleDraftChange = useCallback(
    (draft: string) => {
      if (!selectedCustomerId) return;
      if (draft) draftsRef.current.set(selectedCustomerId, draft);
      else draftsRef.current.delete(selectedCustomerId);
    },
    [selectedCustomerId]
  );

  const handleSend = useCallback(
    async (content: string, file: File | null): Promise<boolean> => {
      const customerId = selectedCustomerId;
      const offerId = replyOfferId;
      if (!customerId || !offerId) return false;

      let attachment: { url: string; type: string; name: string } | null = null;
      if (file) {
        const ext = file.name.split(".").pop() || "bin";
        const path = `${companyId}/${customerId}/${generateLocalId()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("message_attachments").upload(path, file);
        if (uploadError) {
          reportClientError(uploadError, { context: { action: "Last opp vedlegg i melding", companyId, customerId } });
          toast.error("Kunne ikke laste opp filen", { description: "Sjekk nettet og prøv igjen." });
          return false;
        }
        const { data } = supabase.storage.from("message_attachments").getPublicUrl(path);
        attachment = { url: data.publicUrl, type: file.type, name: file.name };
      }

      const payload = {
        customerId,
        offerId,
        content,
        attachmentUrl: attachment?.url ?? null,
        attachmentType: attachment?.type ?? null,
        attachmentName: attachment?.name ?? null,
      };

      const tempId = generateLocalId();
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          customer_id: customerId,
          offer_id: offerId,
          sender_type: "company",
          sender_id: currentUserId,
          content,
          created_at: new Date().toISOString(),
          read_at: null,
          attachment_url: payload.attachmentUrl,
          attachment_type: payload.attachmentType,
          attachment_name: payload.attachmentName,
        },
      ]);

      try {
        const response = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          reportClientError(result?.error || "Kunne ikke sende melding", {
            context: { action: "Send melding til kunde", companyId, customerId, status: response.status },
          });
          toast.error("Meldingen ble ikke sendt", { description: "Teksten står igjen i feltet. Prøv igjen." });
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return false;
        }
        if (result.message) setMessages((prev) => prev.map((m) => (m.id === tempId ? result.message : m)));
        draftsRef.current.delete(customerId);
        return true;
      } catch (err) {
        reportClientError(err, { context: { action: "Send melding til kunde", companyId, customerId } });
        toast.error("Meldingen ble ikke sendt", { description: "Sjekk nettet. Teksten står igjen i feltet." });
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return false;
      }
    },
    [companyId, currentUserId, replyOfferId, selectedCustomerId, supabase]
  );

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center" role="status">
        <span className="sr-only">Henter meldinger…</span>
        <MessageSquare className="size-6 animate-pulse text-muted-foreground/50" aria-hidden="true" />
      </div>
    );
  }

  const details = selectedCustomer ? (
    <ConversationDetails
      customer={selectedCustomer}
      offer={replyOffer}
      otherOffers={customerOffers.filter((o) => o.id !== replyOffer?.id)}
      project={project}
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      <ConversationList
        conversations={visibleConversations}
        totalCount={conversations.length}
        counts={counts}
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        selectedCustomerId={selectedCustomerId}
        onSelect={handleSelect}
        onNewMessage={() => setNewDialogOpen(true)}
        onRefresh={() => void load("refresh")}
        isRefreshing={isRefreshing}
        now={now}
      />

      <div className={cn("flex h-full min-h-0 min-w-0 flex-1", !selectedCustomer && "hidden md:flex")}>
        {selectedCustomer ? (
          <>
            <MessageThread
              customer={selectedCustomer}
              messages={thread}
              offers={offers}
              headerOffer={replyOffer}
              onBack={() => setSelectedCustomerId(null)}
              onShowDetails={() => setDetailsOpen(true)}
              now={now}
            >
              <Composer
                key={selectedCustomer.id}
                customerId={selectedCustomer.id}
                customerName={selectedCustomer.name}
                offers={customerOffers}
                replyOfferId={replyOfferId}
                onReplyOfferChange={(offerId) =>
                  setReplyOfferChoice((prev) => ({ ...prev, [selectedCustomer.id]: offerId }))
                }
                canNotifyByEmail={Boolean(replyOffer?.recipient_email || selectedCustomer.email)}
                canUseAi={canUseAi}
                initialDraft={draftsRef.current.get(selectedCustomer.id) ?? ""}
                onDraftChange={handleDraftChange}
                onSend={handleSend}
              />
            </MessageThread>

            <aside
              aria-label="Kunde og tilbud"
              className="hidden w-[272px] shrink-0 overflow-y-auto border-l border-border bg-card px-4 py-4 xl:block"
            >
              {details}
            </aside>

            <ResponsiveDialog open={detailsOpen} onOpenChange={setDetailsOpen}>
              <ResponsiveDialogContent className="sm:max-w-sm">
                <ResponsiveDialogHeader>
                  <ResponsiveDialogTitle>Kunde og tilbud</ResponsiveDialogTitle>
                </ResponsiveDialogHeader>
                <div className="px-4 pb-6 sm:px-0 sm:pb-0">{details}</div>
              </ResponsiveDialogContent>
            </ResponsiveDialog>
          </>
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center bg-muted/10 px-6 text-center">
            <MessageSquare aria-hidden="true" className="mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              {conversations.length > 0 ? "Velg en samtale" : "Kundesamtaler samles her"}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {counts.needsReply > 0
                ? `${counts.needsReply} ${counts.needsReply === 1 ? "kunde venter" : "kunder venter"} på svar.`
                : "Kundene skriver til deg fra tilbudet de har fått. Svarene dine vises samme sted."}
            </p>
          </div>
        )}
      </div>

      <NewConversationDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        customers={customers}
        offers={offers}
        onPick={handlePickNew}
      />
    </div>
  );
}

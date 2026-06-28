"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format, isToday, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import {
  SendHorizonalIcon,
  MessageSquare,
  Loader2,
  Paperclip,
  ImageIcon,
  X,
  FileIcon,
  Download,
  Search,
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn, generateLocalId } from "@/lib/utils";
import { reportClientError } from "@/lib/errors/client";
import { useUserRole } from "@/hooks/use-user-role";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface Message {
  id: string;
  customer_id: string;
  offer_id?: string | null;
  sender_type: "company" | "customer";
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
}

type FilterTab = "all" | "unread";

interface InboxClientProps {
  companyId: string;
  currentUserId: string;
}

function isUnread(message: Message) {
  return message.sender_type === "customer" && !message.read_at;
}

function formatMessageTime(date: Date) {
  if (isToday(date)) {
    return format(date, "HH:mm", { locale: nb });
  }
  return formatDistanceToNow(date, { addSuffix: true, locale: nb });
}

export default function InboxClient({ companyId, currentUserId }: InboxClientProps) {
  const supabase = createClient();
  const { hasFeature } = useUserRole();
  const canUseAi = hasFeature("meldinger_ki");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const selectedCustomerIdRef = useRef<string | null>(null);
  const customersRef = useRef<Customer[]>([]);

  messagesRef.current = messages;
  selectedCustomerIdRef.current = selectedCustomerId;
  customersRef.current = customers;

  const markThreadAsRead = useCallback(
    async (customerId: string) => {
      const unreadIds = messagesRef.current
        .filter((m) => m.customer_id === customerId && isUnread(m))
        .map((m) => m.id);

      if (unreadIds.length === 0) return;

      const now = new Date().toISOString();

      setMessages((prev) =>
        prev.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: now } : m))
      );

      const { error } = await supabase
        .from("messages")
        .update({ read_at: now })
        .in("id", unreadIds);

      if (error) {
        console.error("Failed to mark messages as read:", error);
        reportClientError(error, {
          level: "warning",
          context: { action: "Marker meldinger som lest", customerId },
        });
        setMessages((prev) =>
          prev.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: null } : m))
        );
      }
    },
    [supabase]
  );

  const handleSelectCustomer = useCallback(
    (customerId: string) => {
      setSelectedCustomerId(customerId);
      void markThreadAsRead(customerId);
    },
    [markThreadAsRead]
  );

  useEffect(() => {
    async function loadData() {
      const { data: customersData, error: customersError } = await supabase
        .from("customers")
        .select("id, name, email, phone")
        .eq("company_id", companyId);

      if (customersError) {
        console.error("Error fetching customers:", customersError);
        reportClientError(customersError, {
          context: { action: "Hent kunder i meldinger", companyId },
        });
        toast.error("Kunne ikke hente kunder");
      }

      if (customersData) setCustomers(customersData);

      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        console.error("Error fetching messages:", messagesError);
        reportClientError(messagesError, {
          context: { action: "Hent meldinger", companyId },
        });
        toast.error("Kunne ikke hente meldinger");
      }

      if (messagesData) setMessages(messagesData);
      setIsLoading(false);
    }
    loadData();
  }, [companyId, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("messages_channel")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          if (newMsg.sender_type === "customer") {
            if (newMsg.customer_id === selectedCustomerIdRef.current) {
              void markThreadAsRead(newMsg.customer_id);
            } else {
              const customer = customersRef.current.find((c) => c.id === newMsg.customer_id);
              toast.info("Ny melding fra kunde", {
                description: customer
                  ? `${customer.name}: ${newMsg.content.slice(0, 80)}${newMsg.content.length > 80 ? "…" : ""}`
                  : newMsg.content.slice(0, 80),
                action: {
                  label: "Åpne",
                  onClick: () => handleSelectCustomer(newMsg.customer_id),
                },
              });
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, supabase, markThreadAsRead, handleSelectCustomer]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedCustomerId]);

  // Forkast et åpent KI-forslag når man bytter samtale.
  useEffect(() => {
    setAiSuggestion(null);
    setIsSuggesting(false);
  }, [selectedCustomerId]);

  const requestSuggestion = useCallback(async () => {
    if (!selectedCustomerId || isSuggesting) return;
    setIsSuggesting(true);
    try {
      const res = await fetch("/api/messages/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedCustomerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Kunne ikke lage forslag");
      setAiSuggestion(typeof data.suggestion === "string" ? data.suggestion : "");
    } catch (err) {
      reportClientError(err, {
        context: { action: "Be om KI-svarforslag", customerId: selectedCustomerId },
      });
      toast.error(err instanceof Error ? err.message : "Kunne ikke lage forslag");
    } finally {
      setIsSuggesting(false);
    }
  }, [selectedCustomerId, isSuggesting]);

  const acceptSuggestion = useCallback(() => {
    if (!aiSuggestion) return;
    setNewMessage(aiSuggestion);
    setAiSuggestion(null);
    // Raise the iOS soft keyboard: focus() must run synchronously inside this
    // click gesture — iOS WebKit withholds the keyboard when focus() is deferred
    // into requestAnimationFrame (the user-activation chain is already broken).
    // The height recompute + caret-to-end still need the post-render DOM
    // (scrollHeight and the freshly-set value), so they stay in the rAF.
    const ta = document.getElementById("chat-textarea") as HTMLTextAreaElement | null;
    ta?.focus();
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.style.height = "40px";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [aiSuggestion]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e as unknown as React.FormEvent);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      if (e.target.files[0].size > 10 * 1024 * 1024) {
        toast.error("Filen er for stor", { description: "Maks filstørrelse er 10MB." });
        return;
      }
      setAttachedFile(e.target.files[0]);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !attachedFile) || !selectedCustomerId || isUploading || isSending)
      return;

    setIsSending(true);

    let attachmentData = {};

    if (attachedFile) {
      setIsUploading(true);
      const fileExt = attachedFile.name.split(".").pop() || "bin";
      const fileName = `${generateLocalId()}.${fileExt}`;
      const filePath = `${companyId}/${selectedCustomerId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("message_attachments")
        .upload(filePath, attachedFile);

      if (uploadError) {
        console.error("Storage upload error", uploadError);
        reportClientError(uploadError, {
          context: { action: "Last opp vedlegg i melding", companyId, customerId: selectedCustomerId },
        });
        toast.error("Kunne ikke laste opp filen", { description: uploadError.message });
        setIsUploading(false);
        setIsSending(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("message_attachments")
        .getPublicUrl(filePath);

      attachmentData = {
        attachment_url: publicUrlData.publicUrl,
        attachment_type: attachedFile.type,
        attachment_name: attachedFile.name,
      };
    }

    const threadMessages = messages.filter((message) => message.customer_id === selectedCustomerId);
    const threadOfferId =
      [...threadMessages].reverse().find((message) => message.offer_id)?.offer_id || null;

    const payload = {
      customerId: selectedCustomerId,
      offerId: threadOfferId,
      content: newMessage.trim(),
      attachmentUrl: (attachmentData as { attachment_url?: string }).attachment_url || null,
      attachmentType: (attachmentData as { attachment_type?: string }).attachment_type || null,
      attachmentName: (attachmentData as { attachment_name?: string }).attachment_name || null,
    };

    setNewMessage("");
    setAttachedFile(null);
    setIsUploading(false);
    setAiSuggestion(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";

    const textarea = document.getElementById("chat-textarea") as HTMLTextAreaElement;
    if (textarea) textarea.style.height = "44px";

    const tempId = generateLocalId();
    const optimisticMsg: Message = {
      id: tempId,
      customer_id: selectedCustomerId,
      offer_id: threadOfferId,
      sender_type: "company",
      sender_id: currentUserId,
      content: payload.content,
      created_at: new Date().toISOString(),
      read_at: null,
      attachment_url: payload.attachmentUrl,
      attachment_type: payload.attachmentType,
      attachment_name: payload.attachmentName,
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("Failed to send message", result);
        reportClientError(result?.error || "Kunne ikke sende melding", {
          context: { action: "Send melding til kunde", companyId, customerId: selectedCustomerId, status: response.status },
        });
        toast.error("Kunne ikke sende melding", {
          description: "Vennligst prøv igjen senere.",
        });
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } else if (result.message) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? result.message : m)));
      }
    } catch (err) {
      console.error("Failed to send message", err);
      reportClientError(err, {
        context: { action: "Send melding til kunde", companyId, customerId: selectedCustomerId },
      });
      toast.error("Kunne ikke sende melding", {
        description: "Vennligst prøv igjen senere.",
      });
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setIsSending(false);
    }
  };

  const conversations = useMemo(() => {
    const customerIdsWithMessages = new Set(messages.map((m) => m.customer_id));

    return customers
      .filter((c) => customerIdsWithMessages.has(c.id))
      .map((c) => {
        const cMessages = messages.filter((m) => m.customer_id === c.id);
        const latest = cMessages[cMessages.length - 1];
        const unreadCount = cMessages.filter(isUnread).length;
        return { ...c, latestMessage: latest, unreadCount };
      })
      .sort((a, b) => {
        const timeA = a.latestMessage ? new Date(a.latestMessage.created_at).getTime() : 0;
        const timeB = b.latestMessage ? new Date(b.latestMessage.created_at).getTime() : 0;
        return timeB - timeA;
      });
  }, [customers, messages]);

  const filteredConversations = useMemo(() => {
    let result = conversations;

    if (filterTab === "unread") {
      result = result.filter((c) => c.unreadCount > 0);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.latestMessage?.content.toLowerCase().includes(q)
      );
    }

    return result;
  }, [conversations, filterTab, searchQuery]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const currentMessages = messages.filter((m) => m.customer_id === selectedCustomerId);
  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      {/* Conversation list */}
      <aside
        className={cn(
          "flex h-full min-h-0 flex-col border-r border-border bg-card",
          "w-full md:w-[380px] md:shrink-0",
          selectedCustomerId && "hidden md:flex"
        )}
      >
            <div className="shrink-0 border-b border-border px-4 py-4">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold tracking-tight">Meldinger</h1>
                {totalUnread > 0 && (
                  <Badge variant="secondary" className="bg-accent text-accent-foreground">
                    {totalUnread} ulest{totalUnread !== 1 ? "e" : ""}
                  </Badge>
                )}
              </div>
              <div className="mt-3 flex gap-1">
                <Button
                  variant={filterTab === "all" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setFilterTab("all")}
                >
                  Alle
                </Button>
                <Button
                  variant={filterTab === "unread" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setFilterTab("unread")}
                >
                  Uleste
                  {totalUnread > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                      {totalUnread}
                    </span>
                  )}
                </Button>
              </div>
              <div className="relative mt-3">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Søk i samtaler..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8"
                />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-1 p-2">
                {filteredConversations.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-foreground">
                      {filterTab === "unread" ? "Ingen uleste meldinger" : "Ingen samtaler ennå"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {filterTab === "unread"
                        ? "Du er ajour med alle kundemeldinger."
                        : "Meldinger fra kunder vises her når de skriver via tilbudsvisning."}
                    </p>
                  </div>
                ) : (
                  filteredConversations.map((customer) => {
                    const isSelected = selectedCustomerId === customer.id;
                    return (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => handleSelectCustomer(customer.id)}
                        className={cn(
                          "flex w-full flex-col gap-1 border p-3 text-left transition-colors hover:cursor-pointer",
                          isSelected
                            ? "border-border bg-accent shadow-sm"
                            : "border-transparent hover:bg-muted/60"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="relative shrink-0">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback className="bg-primary/5 text-xs text-primary">
                                {customer.name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            {customer.unreadCount > 0 && (
                              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span
                                className={cn(
                                  "truncate text-sm",
                                  customer.unreadCount > 0 ? "font-semibold" : "font-medium"
                                )}
                              >
                                {customer.name}
                              </span>
                              {customer.latestMessage && (
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {formatMessageTime(new Date(customer.latestMessage.created_at))}
                                </span>
                              )}
                            </div>
                            {customer.latestMessage && (
                              <p
                                className={cn(
                                  "mt-0.5 truncate text-xs",
                                  customer.unreadCount > 0
                                    ? "font-medium text-foreground"
                                    : "text-muted-foreground"
                                )}
                              >
                                {customer.latestMessage.sender_type === "company" ? "Du: " : ""}
                                {customer.latestMessage.content ||
                                  (customer.latestMessage.attachment_url ? "Vedlegg" : "")}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
      </aside>

      {/* Chat thread */}
      <div
        className={cn(
          "flex h-full min-w-0 flex-1 flex-col bg-background",
          !selectedCustomerId && "hidden md:flex"
        )}
      >
            {selectedCustomer ? (
              <>
                <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 md:hidden"
                    onClick={() => setSelectedCustomerId(null)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Tilbake til samtaler</span>
                  </Button>
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/10 text-sm text-primary">
                      {selectedCustomer.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold">{selectedCustomer.name}</h2>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedCustomer.email || selectedCustomer.phone || "Kunde"}
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
                  <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                    {currentMessages.length === 0 ? (
                      <div className="mt-20 flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-muted-foreground">
                        <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/50" />
                        <p className="text-sm font-medium text-foreground">Ingen meldinger ennå</p>
                        <p className="mt-1 text-xs">
                          Start samtalen ved å sende en melding nedenfor.
                        </p>
                      </div>
                    ) : (
                      currentMessages.map((msg) => {
                        const isCompany = msg.sender_type === "company";
                        return (
                          <div
                            key={msg.id}
                            className={cn("flex", isCompany ? "justify-end" : "justify-start")}
                          >
                            <div
                              className={cn(
                                "relative max-w-[85%] px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[70%]",
                                isCompany
                                  ? "bg-primary text-primary-foreground"
                                  : "border border-border bg-muted"
                              )}
                            >
                              {msg.attachment_url && msg.attachment_type?.startsWith("image/") && (
                                <a
                                  href={msg.attachment_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mb-2 block overflow-hidden"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={msg.attachment_url}
                                    alt={msg.attachment_name || "Bildevedlegg"}
                                    className="max-h-60 max-w-full object-cover transition-opacity hover:opacity-90"
                                  />
                                </a>
                              )}
                              {msg.attachment_url && !msg.attachment_type?.startsWith("image/") && (
                                <a
                                  href={msg.attachment_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn(
                                    "mb-2 flex items-center gap-2 p-2.5 transition-colors",
                                    isCompany
                                      ? "bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20"
                                      : "border border-border bg-background text-foreground hover:bg-accent"
                                  )}
                                >
                                  <div
                                    className={cn(
                                      "p-2",
                                      isCompany ? "bg-primary-foreground/20" : "bg-muted"
                                    )}
                                  >
                                    <FileIcon className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1 overflow-hidden">
                                    <p className="truncate text-xs font-medium">
                                      {msg.attachment_name || "Vedlegg"}
                                    </p>
                                  </div>
                                  <Download className="h-4 w-4 shrink-0 opacity-70" />
                                </a>
                              )}
                              {msg.content && (
                                <p className="whitespace-pre-wrap break-words leading-relaxed">
                                  {msg.content}
                                </p>
                              )}
                              <span
                                className={cn(
                                  "mt-1 block text-[9px] font-medium",
                                  isCompany
                                    ? "text-right text-primary-foreground/70"
                                    : "text-left text-muted-foreground/70"
                                )}
                              >
                                {format(new Date(msg.created_at), "d. MMM HH:mm", { locale: nb })}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="shrink-0 border-t border-border bg-background p-4">
                  {attachedFile && (
                    <div className="relative mx-auto mb-3 flex max-w-3xl items-center overflow-hidden border border-border bg-muted/40 p-2.5 shadow-sm">
                      <div className="mr-3 border border-border bg-background p-2.5 text-muted-foreground shadow-sm">
                        {attachedFile.type.startsWith("image/") ? (
                          <ImageIcon className="h-5 w-5" />
                        ) : (
                          <FileIcon className="h-5 w-5" />
                        )}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="truncate pr-4 text-sm font-medium">{attachedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(attachedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          setAttachedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                          if (imageInputRef.current) imageInputRef.current.value = "";
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      {isUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-2.5 backdrop-blur-sm">
                          <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
                          <span className="text-sm font-medium">Laster opp...</span>
                        </div>
                      )}
                    </div>
                  )}
                  {canUseAi && (aiSuggestion !== null || isSuggesting) && (
                    <div className="relative mx-auto mb-3 max-w-3xl rounded-lg border border-primary/30 bg-primary/5 p-3 shadow-sm">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                          <Sparkles className="h-3.5 w-3.5" />
                          KI-forslag
                        </span>
                        <button
                          type="button"
                          onClick={() => setAiSuggestion(null)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label="Forkast forslag"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {isSuggesting && !aiSuggestion ? (
                        <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          KI skriver et forslag…
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                            {aiSuggestion}
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <Button type="button" size="sm" className="h-8" onClick={acceptSuggestion}>
                              <Check className="mr-1.5 h-3.5 w-3.5" />
                              Sett inn
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 text-muted-foreground"
                              onClick={requestSuggestion}
                              disabled={isSuggesting}
                            >
                              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isSuggesting && "animate-spin")} />
                              Nytt forslag
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <form
                    onSubmit={handleSendMessage}
                    className="mx-auto flex max-w-3xl items-end gap-2 border border-border bg-background p-2 shadow-sm transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-ring"
                  >
                    <div className="flex shrink-0 gap-0.5">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={imageInputRef}
                        onChange={handleFileSelect}
                        disabled={isUploading}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                      <input
                        type="file"
                        accept="*"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        disabled={isUploading}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      {canUseAi && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-primary hover:bg-primary/10 hover:text-primary"
                          onClick={requestSuggestion}
                          disabled={isSuggesting || isUploading}
                          title="Foreslå svar med KI"
                          aria-label="Foreslå svar med KI"
                        >
                          {isSuggesting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                    <Textarea
                      id="chat-textarea"
                      placeholder={`Svar ${selectedCustomer.name}…`}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onInput={(e) => {
                        const target = e.currentTarget;
                        target.style.height = "40px";
                        target.style.height = Math.min(target.scrollHeight, 200) + "px";
                      }}
                      className="m-0 min-h-[40px] max-h-[200px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 text-sm leading-5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      style={{ height: "40px" }}
                      rows={1}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="h-9 shrink-0 bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                      disabled={(!newMessage.trim() && !attachedFile) || isUploading || isSending}
                    >
                      {isUploading || isSending ? (
                        <>
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          {isUploading ? "Laster opp…" : "Sender…"}
                        </>
                      ) : (
                        <>
                          <SendHorizonalIcon className="mr-1.5 h-4 w-4" />
                          Send
                        </>
                      )}
                    </Button>
                  </form>
                  <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground">
                    Enter for å sende · Shift + Enter for ny linje
                  </p>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center bg-muted/5 text-muted-foreground">
                <div className="mb-6 flex h-20 w-20 items-center justify-center bg-muted/50">
                  <MessageSquare className="h-10 w-10 text-muted-foreground/50" />
                </div>
                <h3 className="text-xl font-medium tracking-tight text-foreground">
                  Kundesamtaler
                </h3>
                <p className="mt-3 max-w-sm text-center text-sm leading-relaxed">
                  Velg en samtale til venstre for å lese og svare kunder. Meldinger kommer fra
                  tilbudsvisning.
                </p>
              </div>
            )}
      </div>
    </div>
  );
}

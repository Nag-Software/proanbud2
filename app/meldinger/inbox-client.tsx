"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, isToday } from "date-fns";
import { nb } from "date-fns/locale";
import { Send, Users, CircleUser, Loader2, Paperclip, ImageIcon, MoreVertical, X, FileIcon, Download, SendHorizonalIcon } from "lucide-react";
import { toast } from "sonner";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface Message {
  id: string;
  customer_id: string;
  sender_type: "company" | "customer";
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
}

interface InboxClientProps {
  companyId: string;
  currentUserId: string;
}

export default function InboxClient({ companyId, currentUserId }: InboxClientProps) {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    async function loadData() {
      // Fetch customers
      const { data: customersData, error: customersError } = await supabase
        .from("customers")
        .select("id, name, email, phone")
        .eq("company_id", companyId);

      if (customersError) {
        console.error("Error fetching customers:", customersError);
      }

      if (customersData) setCustomers(customersData);

      // Fetch messages
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        console.error("Error fetching messages:", messagesError);
        toast.error("Kunne ikke hente meldinger");
      }

      if (messagesData) setMessages(messagesData);
      setIsLoading(false);
    }
    loadData();

    // Subscribe to new messages
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
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, supabase]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedCustomerId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e as unknown as React.FormEvent);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      // Sjekk at filen ikke er for stor (f.eks 10MB = 10 * 1024 * 1024)
      if (e.target.files[0].size > 10 * 1024 * 1024) {
        toast.error("Filen er for stor", { description: "Maks filstørrelse er 10MB." });
        return;
      }
      setAttachedFile(e.target.files[0]);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !attachedFile) || !selectedCustomerId || isUploading) return;

    let attachmentData = {};

    if (attachedFile) {
      setIsUploading(true);
      const fileExt = attachedFile.name.split('.').pop() || "bin";
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `${companyId}/${selectedCustomerId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('message_attachments')
        .upload(filePath, attachedFile);

      if (uploadError) {
        console.error("Storage upload error", uploadError);
        toast.error("Kunne ikke laste opp filen", { description: uploadError.message });
        setIsUploading(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('message_attachments')
        .getPublicUrl(filePath);

      attachmentData = {
        attachment_url: publicUrlData.publicUrl,
        attachment_type: attachedFile.type,
        attachment_name: attachedFile.name
      };
    }

    const payload = {
      company_id: companyId,
      customer_id: selectedCustomerId,
      sender_type: "company" as const,
      sender_id: currentUserId,
      content: newMessage.trim(),
      ...attachmentData
    };

    setNewMessage("");
    setAttachedFile(null);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
    // Reset textarea height if possible
    const textarea = document.getElementById("chat-textarea") as HTMLTextAreaElement;
    if (textarea) textarea.style.height = '44px';

    // Optimistic UI update
    const tempId = crypto.randomUUID();
    const optimisticMsg: Message = {
      id: tempId,
      ...payload,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    
    setMessages((prev) => [...prev, optimisticMsg]);

    const { data: insertedData, error } = await supabase.from("messages").insert([payload]).select().single();
    
    if (error) {
      console.error("Failed to send message", error);
      toast.error("Kunne ikke sende melding", {
        description: "Vennligst prøv igjen senere."
      });
      // Revert optimistic update
      setMessages((prev) => prev.filter(m => m.id !== tempId));
    } else if (insertedData) {
      // Replace optimistic temp id with actual database id to avoid duplication issues
      setMessages((prev) => prev.map(m => m.id === tempId ? insertedData : m));
    }
  };

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const currentMessages = messages.filter((m) => m.customer_id === selectedCustomerId);

  // Group customers by latest message
  const customersWithLatest = customers.map((c) => {
    const cMessages = messages.filter((m) => m.customer_id === c.id);
    const latest = cMessages[cMessages.length - 1];
    return {
      ...c,
      latestMessage: latest,
    };
  }).sort((a, b) => {
    const timeA = a.latestMessage ? new Date(a.latestMessage.created_at).getTime() : 0;
    const timeB = b.latestMessage ? new Date(b.latestMessage.created_at).getTime() : 0;
    return timeB - timeA;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full max-h-[calc(100vh-5rem)] border rounded-lg bg-card shadow-sm overflow-hidden m-4 mx-6 max-w-7xl self-center">
      {/* Sidebar */}
      <div className="w-80 border-r flex flex-col bg-muted/10 shrink-0">
        <div className="px-4 py-3 border-b bg-background/50 backdrop-blur-sm shadow-sm z-10 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Meldinger</h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col p-2 space-y-0.5">
            {customersWithLatest.length === 0 ? (
              <p className="text-sm text-center text-muted-foreground mt-4">Ingen kunder ennå</p>
            ) : (
              customersWithLatest.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => setSelectedCustomerId(customer.id)}
                  className={`flex items-start gap-3 p-2.5 text-left rounded-lg hover:cursor-pointer transition-all ${
                    selectedCustomerId === customer.id 
                      ? "bg-accent shadow-sm" 
                      : "hover:bg-accent/50 transparent"
                  }`}
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className="bg-primary/5 text-primary text-sm">
                      {customer.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="font-medium text-sm truncate pr-2">{customer.name}</span>
                      {customer.latestMessage && (
                        <span className={`text-[10px] shrink-0 ${selectedCustomerId === customer.id ? "text-foreground/70" : "text-muted-foreground"}`}>
                          {format(new Date(customer.latestMessage.created_at), isToday(new Date(customer.latestMessage.created_at)) ? 'HH:mm' : 'dd. MMM', { locale: nb })}
                        </span>
                      )}
                    </div>
                    {customer.latestMessage ? (
                      <p className={`text-xs truncate ${selectedCustomerId === customer.id ? "text-foreground/80" : "text-muted-foreground"}`}>
                        {customer.latestMessage.sender_type === "company" ? "Du: " : ""}
                        {customer.latestMessage.content}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/50 italic">Ingen meldinger</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-background relative">
        {selectedCustomer ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between shadow-sm z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {selectedCustomer.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold text-sm leading-tight">{selectedCustomer.name}</h3>
                  <p className="text-xs text-muted-foreground">{selectedCustomer.email || selectedCustomer.phone || "Kunde"}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 p-4 overflow-y-auto" ref={scrollRef}>
              <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full">
                {currentMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 mt-20 text-center text-muted-foreground bg-muted/20 rounded-2xl border border-dashed">
                    <CircleUser className="w-10 h-10 mb-3 text-muted-foreground/50" />
                    <p className="text-sm font-medium text-foreground">Ingen meldinger ennå</p>
                    <p className="text-xs mt-1">Start samtalen ved å sende en melding nedenfor.</p>
                  </div>
                ) : (
                  currentMessages.map((msg, index) => {
                    const isCompany = msg.sender_type === "company";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isCompany ? "justify-end" : "justify-start"} group`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] px-3.5 py-2.5 rounded-2xl text-sm shadow-sm relative ${
                            isCompany
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted rounded-bl-sm border"
                          }`}
                        >
                          {msg.attachment_url && msg.attachment_type?.startsWith("image/") && (
                            <a href={msg.attachment_url} target="_blank" rel="noreferrer" className="block mb-2 overflow-hidden rounded-xl">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={msg.attachment_url} alt={msg.attachment_name || "Bildevedlegg"} className="max-w-full max-h-60 object-cover hover:opacity-90 transition-opacity" />
                            </a>
                          )}
                          {msg.attachment_url && !msg.attachment_type?.startsWith("image/") && (
                            <a 
                              href={msg.attachment_url} 
                              target="_blank" 
                              rel="noreferrer" 
                              className={`flex items-center gap-2 p-2.5 rounded-xl mb-2 transition-colors ${
                                isCompany ? "bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground" : "bg-background hover:bg-accent border text-foreground"
                              }`}
                            >
                              <div className={`p-2 rounded-lg ${isCompany ? "bg-primary-foreground/20" : "bg-muted"}`}>
                                <FileIcon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 overflow-hidden">
                                <p className="text-xs font-medium truncate">{msg.attachment_name || "Vedlegg"}</p>
                              </div>
                              <Download className="h-4 w-4 shrink-0 opacity-70" />
                            </a>
                          )}
                          {msg.content && <p className="break-words whitespace-pre-wrap leading-relaxed">{msg.content}</p>}
                          <span
                            className={`text-[9px] mt-1 block font-medium ${
                              isCompany ? "text-primary-foreground/70 text-right" : "text-muted-foreground/70 text-left"
                            }`}
                          >
                            {format(new Date(msg.created_at), "HH:mm")}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Input Area */}
            <div className="p-3 bg-background border-t">
              {attachedFile && (
                <div className="max-w-3xl mx-auto mb-3 flex items-center bg-muted/40 p-2.5 rounded-xl border shadow-sm relative overflow-hidden group">
                  <div className="bg-background p-2.5 rounded-lg mr-3 shadow-sm border text-muted-foreground">
                    {attachedFile.type.startsWith("image/") ? <ImageIcon className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium truncate pr-4">{attachedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(attachedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full" 
                    onClick={() => {
                      setAttachedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                      if (imageInputRef.current) imageInputRef.current.value = "";
                    }}
                  >
                    <X className="h-4 w-4"/>
                  </Button>
                  
                  {isUploading && (
                     <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center rounded-xl p-2.5">
                        <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
                        <span className="text-sm font-medium">Laster opp...</span>
                     </div>
                  )}
                </div>
              )}
              <form
                onSubmit={handleSendMessage}
                className="max-w-3xl mx-auto flex items-end gap-1 bg-background p-1.5 rounded-lg border focus-within:ring-1 focus-within:ring-ring focus-within:border-primary transition-colors shadow-sm"
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
                    className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md shrink-0"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <ImageIcon className="h-5 w-5" />
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
                    className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <Paperclip className="h-5 w-5" />
                  </Button>
                </div>

                <div className="flex-1">
                  <Textarea
                    id="chat-textarea"
                    placeholder="Skriv en melding..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onInput={(e) => {
                      const target = e.currentTarget;
                      target.style.height = '40px';
                      target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                    }}
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-[10px] w-full resize-none min-h-[40px] max-h-[200px] text-base sm:text-sm overflow-y-auto m-0 leading-5"
                    style={{ height: '40px' }}
                    rows={1}
                  />
                </div>
                
                <div className="flex shrink-0">
                  <Button
                    type="submit"
                    size="icon"
                    className="h-10 w-10 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all active:scale-95 disabled:opacity-50 shrink-0"
                    disabled={(!newMessage.trim() && !attachedFile) || isUploading}
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonalIcon className="w-4 h-4" />}
                  </Button>
                </div>
              </form>
              <div className="max-w-3xl mx-auto mt-2 text-center">
                <span className="text-[10px] text-muted-foreground">Trykk Enter for å sende, Shift + Enter for ny linje</span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground bg-muted/5">
            <div className="h-20 w-20 bg-muted/50 rounded-full flex items-center justify-center mb-6">
              <Users className="w-10 h-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-xl font-medium text-foreground tracking-tight">Kundeinnboks</h3>
            <p className="text-sm text-center max-w-sm mt-3 leading-relaxed">
              Velg en kunde fra listen til venstre for å se meldinger eller starte en ny samtale opprettet fra et tilbud.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed';

export interface Project {
  id: string;
  company_id: string;
  name: string;
  customer_id?: string | null;
  created_by?: string | null;
  status: ProjectStatus;
  project_type: string;
  start_date?: string | null;
  end_date?: string | null;
  budget_nok: number;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiData {
  title: string;
  value: string;
  change?: string;
  icon: string;
}

export interface ChartDataPoint {
  date: string;
  omsatt: number;
  tilbudt: number;
}

export interface ActivityItem {
  id: string;
  type: 'tilbud_sendt' | 'tilbud_vunnet' | 'tilbud_tapt' | 'ny_kunde';
  title: string;
  description: string;
  timestamp: string;
  amount?: number;
}

export interface ConversationEntry {
  message: string;
  timestamp: number;
  sentBy: 'customer' | 'business';
  sentTo?: string;
  emailId?: string;
  type?: 'quote_question' | 'quote_approved' | 'quote_rejected' | 'reply';
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  children?: Folder[];
}

export interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  quoteId?: string;
  customerId?: string;
  type: 'quote_sent' | 'quote_draft' | 'quote_opened' | 'quote_question' | 'quote_approved' | 'quote_rejected' | 'quote_conversation' | 'general_inquiry' | 'outgoing_reply';
  customerName?: string;
  quoteTitle?: string;
  isFlagged?: boolean;
  folder?: string;
  archivedAt?: number; // Timestamp when message was archived
  hasReply?: boolean;
  relatedMessageId?: string; // Link to original message for replies
  sentTo?: string; // Email address for outgoing messages
  emailId?: string; // Email service ID for tracking
  lastReplyAt?: number;
  lastMessageAt?: number; // Timestamp of last message in conversation
  conversation?: Record<string, ConversationEntry>;
}

export interface CustomerFeedback {
  id: string;
  quoteId: string;
  message: string;
  timestamp: string;
  customerName: string;
  type: 'question' | 'comment' | 'approval' | 'rejection';
}

export interface Tilbud {
  id: string;
  kundenavn: string;
  prosjekt: string;
  jobbtype: string;
  belop: number;
  beskrivelse?: string;
  notater?: string;
  status: 'draft' | 'venter' | 'vunnet' | 'tapt';
  dato: string;
  svarfrist: string;
  prisgrunnlag?: PriceComponent[];
  template?: string;
  viewToken?: string; // Unique token for customer to view quote without auth
  userId?: string; // Owner of the quote
  attachments?: Attachment[];
}

export interface Attachment {
  name: string;
  url: string;
  type?: string;
  size?: number;
  storagePath?: string;
}

export interface Kunde {
  id: string;
  navn: string;
  epost: string;
  telefon: string;
  antallTilbud: number;
  antallVunnet: number;
  sistAktivitet: string;
  addresser: string[];
  tilbud: Tilbud[];
  notater?: string;
}

export interface JobbtypeAnalyse {
  jobbtype: string;
  treffprosent: number;
  antallTilbud: number;
  antallVunnet: number;
}

export interface PriceComponent {
  id: string;
  category: 'materialer' | 'arbeid' | 'transport' | 'utstyr' | 'margin' | 'annet';
  name: string;
  description: string;
  produsent?: string;
  projectCategory?: string; // High-level AI grouping like "Bygge terrasse"
  projectCategoryDescription?: string;
  amount: number;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  priceMarkup?: number; // Percentage markup on base price
  materialMarkup?: number; // Additional markup for materials
  componentTotal?: number; // Raw total from AI response before recalculation
  catalogMatch?: string;
  catalogSource?: string;
  isEditable: boolean;
  confidence: number; // 0-100, how confident AI is in this estimate
}

export interface AIPriceSuggestion {
  totalPrice: number;
  confidence: number; // Overall confidence 0-100
  components: PriceComponent[];
  reasoning: string;
  alternatives?: {
    conservative: number;
    aggressive: number;
  };
}

export interface InntektFordeling {
  jobbtype: string;
  inntekt: number;
  prosent: number;
  color: string;
}

export interface NavLink {
  href: string;
  label: string;
  icon: string;
}

export interface User {
  navn: string;
  bedrift: string;
  avatar?: string;
}

export type TilbudStatus = 'draft' | 'venter' | 'vunnet' | 'tapt';

export interface ColumnDef {
  accessorKey: string;
  header: string;
  cell?: (info: any) => React.ReactNode;
  weight?: 'thin' | 'regular' | 'medium' | 'semibold' | 'bold';
}

export interface BusinessSettings {
  // Company Information
  companyName: string;
  organizationNumber: string;
  address: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  
  // Business Details for AI & Analytics
  foundedYear: number;
  employeeCount: number;
  industry: string;
  businessType: 'enkeltpersonforetak' | 'as' | 'asa' | 'da' | 'ans' | 'ba' | 'other';
  annualRevenue: number;
  hourlyRateWithoutVat?: number;
  serviceAreas: string[];
  specializations: string[];
  
  // Branding & Design
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  brandDescription: string;
  
  // Financial Settings
  currency: string;
  vatRate: number;
  defaultPaymentTerms: number;
  bankAccount: string;
  
  // Quote & Document Settings
  quoteValidityDays: number;
  quotePrefix: string;
  invoicePrefix: string;
  defaultQuoteNotes: string;
  
  // AI & Prediction Settings
  aiEnabled: boolean;
  marketSegment: string;
  competitorAnalysis: string;
  pricingStrategy: 'low' | 'medium' | 'premium';
  
  // Metadata
  lastUpdated?: any;
  createdAt?: any;
}

// Catalog Types
export interface Product {
  id: string;
  produktnavn: string;
  produsent: string;
  enhet: string; // e.g., 'stk', 'meter', 'liter', 'kg'
  enhetspris: number;
  påslag: number; // Markup percentage
  kategoriId: string;
  underkategoriId: string;
  beskrivelse?: string;
  opprettet: number;
  oppdatert: number;
}

export interface Subcategory {
  id: string;
  navn: string;
  kategoriId: string;
  beskrivelse?: string;
  opprettet: number;
  oppdatert: number;
}

export interface Category {
  id: string;
  navn: string;
  beskrivelse?: string;
  opprettet: number;
  oppdatert: number;
}

export interface ProductFormData {
  produktnavn: string;
  produsent: string;
  enhet: string;
  enhetspris: number;
  påslag: number;
  kategoriId: string;
  underkategoriId: string;
  beskrivelse?: string;
}

export interface CategoryFormData {
  navn: string;
  beskrivelse?: string;
}

export interface SubcategoryFormData {
  navn: string;
  kategoriId: string;
  beskrivelse?: string;
}export type QuotaSettings = any;

export type QuotaDetail = {
  id: string
  project: string
  description: string
  amount: number
  status: "utkast" | "sendt" | "godkjent" | "avvist" | "fullført"
  created: string
  updated: string
  validUntil: string
  assignedTo: string
  reference: string
  settings: QuotaSettings
  customer: {
    name: string
    orgNumber: string
    address: string
    postalCode: string
    city: string
  }
  contact: {
    name: string
    role: string
    email: string
    phone: string
  }
  scope: {
    location: string
    timeframe: string
    delivery: string
  }
  terms: {
    payment: string
    warranty: string
    validity: string
  }
  notes?: string;
  documents: Array<{
    name: string
    type: string
    updated: string
  }>
}

export type QuotaSettingsFieldValue = any;

export type QuotaSettingsField = {
  id: string
  label: string
  type: string
  description?: string
  value?: QuotaSettingsFieldValue
  options?: any[] 
  placeholder?: string
}

export type QuotaSettingsSection = {
  id?: string
  title?: string
  name: string
  icon?: any
  gridColNum?: number
  fields?: QuotaSettingsField[]
}

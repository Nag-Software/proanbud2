CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL, 
  sender_type TEXT NOT NULL CHECK (sender_type IN ('company', 'customer')),
  sender_id UUID, 
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages for their company" ON public.messages;
CREATE POLICY "Users can view messages for their company"
ON public.messages FOR SELECT
TO authenticated
USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "Users can insert messages for their company" ON public.messages;
CREATE POLICY "Users can insert messages for their company"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "Users can update messages for their company" ON public.messages;
CREATE POLICY "Users can update messages for their company"
ON public.messages FOR UPDATE
TO authenticated
USING (company_id = public.get_current_company_id());

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;


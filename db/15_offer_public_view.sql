-- 15_offer_public_view.sql
-- Digitalt tilbud for kunde via offentlig lenke (/tilbudsvisning/[slug]).

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS public_slug TEXT,
  ADD COLUMN IF NOT EXISTS customer_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_responded_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_public_slug ON public.offers(public_slug) WHERE public_slug IS NOT NULL;

-- Sikrer at meldinger kan knyttes til tilbud i kundechat.
CREATE INDEX IF NOT EXISTS idx_messages_offer_id ON public.messages(offer_id, created_at DESC);

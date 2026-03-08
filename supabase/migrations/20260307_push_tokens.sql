-- ============================================================
--  push_tokens table
--  Stores Expo push tokens per user (one per device)
--  Safe to re-run (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'ios',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active token per user (replace on re-register)
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_user_id ON public.push_tokens(user_id);

-- RLS: users can only read/write their own token
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'push_tokens_own'
  ) THEN
    CREATE POLICY push_tokens_own ON public.push_tokens
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END;
$$;

-- Service role can read all (for edge functions)
GRANT SELECT ON public.push_tokens TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;

SELECT 'push_tokens table ready.' AS status;

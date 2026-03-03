-- Tier rewards configuration per barber
CREATE TABLE IF NOT EXISTS tier_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  barber_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  visits_required INTEGER NOT NULL DEFAULT 1 CHECK (visits_required >= 0),
  perk_type TEXT NOT NULL DEFAULT 'custom' CHECK (perk_type IN ('discount', 'free_addon', 'bonus_points', 'custom')),
  perk_value TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(barber_id, tier)
);

-- RLS
ALTER TABLE tier_config ENABLE ROW LEVEL SECURITY;

-- Barbers can read/write their own config
CREATE POLICY "Barbers manage own tier config"
  ON tier_config
  FOR ALL
  USING (barber_id = auth.uid())
  WITH CHECK (barber_id = auth.uid());

-- Clients can read any barber's active config
CREATE POLICY "Anyone can read active tier config"
  ON tier_config
  FOR SELECT
  USING (is_active = true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_tier_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tier_config_updated_at
  BEFORE UPDATE ON tier_config
  FOR EACH ROW
  EXECUTE FUNCTION update_tier_config_updated_at();

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  game_id text PRIMARY KEY,
  ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  game_creation bigint NOT NULL,
  duration integer NOT NULL DEFAULT 0,
  game_mode text NOT NULL DEFAULT 'CUSTOM',
  game_type text NOT NULL DEFAULT 'CUSTOM_GAME',
  queue_id integer NOT NULL DEFAULT 0,
  has_timeline boolean NOT NULL DEFAULT false,
  timeline_collected boolean NOT NULL DEFAULT false,
  timeline_source text NOT NULL DEFAULT '',
  timeline_error text NOT NULL DEFAULT '',
  epic_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matches_game_creation_idx ON matches (game_creation DESC);
CREATE INDEX IF NOT EXISTS matches_uploaded_at_idx ON matches (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS matches_timeline_collected_idx ON matches (timeline_collected, game_creation DESC);

CREATE TABLE IF NOT EXISTS match_participants (
  game_id text NOT NULL REFERENCES matches(game_id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 10),
  participant_id smallint,
  puuid text NOT NULL DEFAULT '',
  game_name text NOT NULL DEFAULT '',
  tag_line text NOT NULL DEFAULT '',
  team_id smallint NOT NULL DEFAULT 0,
  win boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'MID',
  champion_id integer,
  champion_key text NOT NULL DEFAULT '',
  champion_name text NOT NULL DEFAULT '',
  kills integer NOT NULL DEFAULT 0,
  deaths integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  damage bigint NOT NULL DEFAULT 0,
  gold bigint NOT NULL DEFAULT 0,
  vision bigint NOT NULL DEFAULT 0,
  cs bigint NOT NULL DEFAULT 0,
  damage_taken bigint,
  mitigated bigint,
  turret_damage bigint,
  objective_damage bigint,
  healing bigint,
  units_healed bigint,
  heals_on_teammates bigint,
  shields_on_teammates bigint,
  cc_time bigint,
  total_cc_time bigint,
  wards_placed bigint,
  wards_killed bigint,
  control_wards bigint,
  turret_kills integer NOT NULL DEFAULT 0,
  inhibitor_kills integer NOT NULL DEFAULT 0,
  objectives_stolen integer NOT NULL DEFAULT 0,
  objectives_stolen_assists integer NOT NULL DEFAULT 0,
  solo_kills integer NOT NULL DEFAULT 0,
  solo_deaths integer NOT NULL DEFAULT 0,
  triple_kills integer NOT NULL DEFAULT 0,
  quadra_kills integer NOT NULL DEFAULT 0,
  penta_kills integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  PRIMARY KEY (game_id, slot)
);

CREATE INDEX IF NOT EXISTS match_participants_puuid_idx ON match_participants (puuid);
CREATE INDEX IF NOT EXISTS match_participants_name_idx ON match_participants (lower(game_name), lower(tag_line));
CREATE INDEX IF NOT EXISTS match_participants_role_idx ON match_participants (role, game_id);

CREATE TABLE IF NOT EXISTS match_timelines (
  game_id text PRIMARY KEY REFERENCES matches(game_id) ON DELETE CASCADE,
  frame_interval integer NOT NULL DEFAULT 60000,
  frames jsonb NOT NULL DEFAULT '[]'::jsonb,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeline jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keeps this migration safe if an early development copy created `matches`
-- before the concurrency marker was added.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS has_timeline boolean NOT NULL DEFAULT false;
UPDATE matches SET has_timeline=true
WHERE has_timeline=false AND EXISTS (SELECT 1 FROM match_timelines t WHERE t.game_id=matches.game_id);

INSERT INTO schema_migrations (version) VALUES ('001_match_store')
ON CONFLICT (version) DO NOTHING;

COMMIT;

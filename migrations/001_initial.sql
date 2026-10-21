CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 18),
  gender TEXT NOT NULL,
  seeking TEXT NOT NULL,
  min_age INTEGER NOT NULL CHECK (min_age >= 18),
  max_age INTEGER NOT NULL CHECK (max_age >= min_age),
  answers TEXT NOT NULL,
  vector TEXT NOT NULL,
  questionnaire_version TEXT NOT NULL,
  analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK (analytics_consent IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE decisions (
  actor_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('like', 'pass')),
  created_at TEXT NOT NULL DEFAULT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (actor_id, target_id),
  CHECK (actor_id <> target_id)
);

CREATE TABLE candidate_tokens (
  token TEXT PRIMARY KEY,
  viewer_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  UNIQUE (viewer_id, target_id),
  CHECK (viewer_id <> target_id)
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  UNIQUE (user_a, user_b),
  CHECK (user_a COLLATE "C" < user_b COLLATE "C")
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX messages_room_time ON messages(room_id, created_at, id);
CREATE INDEX messages_sender_time ON messages(sender_id, created_at);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE analytics_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX analytics_event_time ON analytics_events(event_name, occurred_at);
CREATE INDEX analytics_user_event_time ON analytics_events(user_id, event_name, occurred_at);
CREATE UNIQUE INDEX analytics_daily_event ON analytics_events(user_id, event_name, substring(occurred_at, 1, 10));

CREATE TABLE local_test_accounts (
  handle TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE app_users (
  user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE referral_codes (
  code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE referral_attributions (
  user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES referral_codes(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  profile_completed_at TIMESTAMPTZ
);
CREATE INDEX referral_attributions_code ON referral_attributions(code);

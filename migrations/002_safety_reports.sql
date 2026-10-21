CREATE TABLE safety_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  reported_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('harassment', 'sexual_content', 'scam', 'underage', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (reporter_id, room_id),
  CHECK (reporter_id <> reported_id)
);
CREATE INDEX safety_reports_queue ON safety_reports(status, created_at);

ALTER TABLE app_users ADD COLUMN session_version UUID NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_user_time ON support_tickets(user_id, created_at);

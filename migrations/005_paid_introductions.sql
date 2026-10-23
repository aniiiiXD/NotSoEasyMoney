-- One captured order buys one introduction, never permanent discovery access.
CREATE TABLE paid_introductions (
  order_id TEXT PRIMARY KEY REFERENCES payment_orders(order_id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  target_id TEXT REFERENCES profiles(user_id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (viewer_id, target_id, mode),
  CHECK (viewer_id <> target_id)
);
CREATE INDEX paid_introductions_viewer_idx ON paid_introductions(viewer_id, mode);

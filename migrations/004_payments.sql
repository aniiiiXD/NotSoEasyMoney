CREATE TABLE payment_orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  receipt TEXT NOT NULL UNIQUE,
  key_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  amount INTEGER NOT NULL CHECK (amount >= 100),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'authorized', 'paid', 'failed', 'refunded')),
  payment_id TEXT UNIQUE,
  amount_refunded INTEGER NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_orders_user_access ON payment_orders(user_id, mode, status);
CREATE INDEX payment_orders_user_recent ON payment_orders(user_id, created_at DESC);

-- Each member's Instagram handle for a room. The other member only sees it
-- once both have shared, at which point the room is closed.
CREATE TABLE instagram_shares (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  handle TEXT NOT NULL CHECK (handle ~ '^[a-z0-9._]{1,30}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- A closed room stays readable (so both members keep the swapped handles)
-- but accepts no new messages or share changes.
ALTER TABLE rooms ADD COLUMN closed_at TIMESTAMPTZ;

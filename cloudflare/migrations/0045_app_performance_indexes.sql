-- Room discovery is polled by signed-in users; serve newest rooms in index order
-- instead of scanning/sorting the entire room table every 25 seconds per client.
CREATE INDEX IF NOT EXISTS idx_sharika_rooms_created_at
  ON sharika_rooms(created_at DESC);

-- Room snapshots poll the first 100 members in join order. A composite index
-- removes the temporary sort while retaining the (room_id,user_id) uniqueness key.
CREATE INDEX IF NOT EXISTS idx_sharika_room_members_room_joined
  ON sharika_room_members(room_id, joined_at);

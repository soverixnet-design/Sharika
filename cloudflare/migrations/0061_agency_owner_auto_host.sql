-- Every eligible Agency/Family owner is also an active Host. This is a
-- role assignment only: it must never credit coins, diamonds, or salaries.
-- Other approved adult Family members still require owner assignment.

CREATE TRIGGER IF NOT EXISTS sharika_agency_owner_auto_host_create
AFTER INSERT ON sharika_families
WHEN NEW.status='active'
BEGIN
  INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by)
  SELECT NEW.owner_uid,NEW.id,1,NEW.bd_uid
  WHERE EXISTS(SELECT 1 FROM sharika_users
    WHERE auth_uid=NEW.owner_uid AND status='active' AND minor=0)
  ON CONFLICT(host_uid) DO UPDATE SET active=1,updated_at=datetime('now')
    WHERE sharika_agency_hosts.family_id=excluded.family_id;
END;

-- A newly approved adult owner receives the Host role when leadership moves.
-- The previous owner keeps an ordinary Host role while still a Family member.
CREATE TRIGGER IF NOT EXISTS sharika_agency_owner_auto_host_transfer
AFTER UPDATE OF owner_uid ON sharika_families
WHEN NEW.status='active' AND NEW.owner_uid<>OLD.owner_uid
BEGIN
  INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by)
  SELECT NEW.owner_uid,NEW.id,1,NEW.bd_uid
  WHERE EXISTS(SELECT 1 FROM sharika_users
    WHERE auth_uid=NEW.owner_uid AND status='active' AND minor=0)
  ON CONFLICT(host_uid) DO UPDATE SET active=1,updated_at=datetime('now')
    WHERE sharika_agency_hosts.family_id=excluded.family_id;
END;

-- Backfill existing active Agencies, including ID 10000001 in staging.
-- Preserve every pre-existing Host assignment and its original Agency.
INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by)
SELECT f.owner_uid,f.id,1,f.bd_uid
FROM sharika_families f JOIN sharika_users u ON u.auth_uid=f.owner_uid
WHERE f.status='active' AND u.status='active' AND u.minor=0
ON CONFLICT(host_uid) DO UPDATE SET active=1,updated_at=datetime('now')
  WHERE sharika_agency_hosts.family_id=excluded.family_id;

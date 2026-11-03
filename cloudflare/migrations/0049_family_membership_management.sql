-- Additional Royal Family management, staging only. No balance or gift rows changed.
PRAGMA foreign_keys=ON;

-- Append-only history: ownership, role changes, removals, status and reopened requests.
CREATE TABLE IF NOT EXISTS sharika_family_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  subject_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN (
    'owner_transfer','member_role','member_remove','request_reopened','family_status'
  )),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_family_activity_family_idx
  ON sharika_family_activity(family_id,id DESC);
CREATE TRIGGER IF NOT EXISTS sharika_family_activity_immutable_update
BEFORE UPDATE ON sharika_family_activity
BEGIN SELECT RAISE(ABORT,'family_activity_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_family_activity_immutable_delete
BEFORE DELETE ON sharika_family_activity
BEGIN SELECT RAISE(ABORT,'family_activity_immutable'); END;

-- A Family may not become leaderless. Transfer only to an existing active member.
-- The original, immutable BD grant remains evidence of who received the grant.
CREATE TRIGGER IF NOT EXISTS sharika_family_owner_transfer_guard
BEFORE UPDATE OF owner_uid ON sharika_families
WHEN NEW.owner_uid<>OLD.owner_uid
BEGIN
  SELECT RAISE(ABORT,'family_owner_transfer_invalid')
  WHERE OLD.status!='active'
     OR NOT EXISTS(
       SELECT 1 FROM sharika_family_members m
       WHERE m.family_id=OLD.id AND m.user_uid=OLD.owner_uid AND m.role='leader'
     )
     OR NOT EXISTS(
       SELECT 1 FROM sharika_family_members m
       JOIN sharika_users u ON u.auth_uid=m.user_uid
       WHERE m.family_id=OLD.id AND m.user_uid=NEW.owner_uid AND u.status='active'
     );
END;

CREATE TRIGGER IF NOT EXISTS sharika_family_owner_transfer_roles
AFTER UPDATE OF owner_uid ON sharika_families
WHEN NEW.owner_uid<>OLD.owner_uid
BEGIN
  UPDATE sharika_family_members SET role='co_leader'
    WHERE family_id=NEW.id AND user_uid=OLD.owner_uid AND role='leader';
  UPDATE sharika_family_members SET role='leader'
    WHERE family_id=NEW.id AND user_uid=NEW.owner_uid;
  INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json)
    VALUES(NEW.id,OLD.owner_uid,NEW.owner_uid,'owner_transfer',
      json_object('previous_owner_uid',OLD.owner_uid,'new_owner_uid',NEW.owner_uid));
END;

-- Only ordinary member/co-leader/elder role updates are logged here. The
-- ownership trigger above logs leader transitions as one distinct event.
CREATE TRIGGER IF NOT EXISTS sharika_family_member_role_audit
AFTER UPDATE OF role ON sharika_family_members
WHEN OLD.role<>NEW.role AND OLD.role!='leader' AND NEW.role!='leader'
BEGIN
  INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json)
    SELECT NEW.family_id,f.owner_uid,NEW.user_uid,'member_role',
      json_object('from',OLD.role,'to',NEW.role)
    FROM sharika_families f WHERE f.id=NEW.family_id;
END;

-- Rejected requests and old accepted requests can be resubmitted after the
-- existing 24-hour leave cooldown. Preserve the prior state in activity.
CREATE TRIGGER IF NOT EXISTS sharika_family_reapply_guard
BEFORE UPDATE OF state ON sharika_family_join_requests
WHEN OLD.state!='pending' AND NEW.state='pending'
BEGIN
  SELECT RAISE(ABORT,'family_join_cooldown')
  WHERE EXISTS(SELECT 1 FROM sharika_family_leaves
    WHERE user_uid=NEW.applicant_uid AND left_at>datetime('now','-1 day'));
  SELECT RAISE(ABORT,'already_in_family')
  WHERE EXISTS(SELECT 1 FROM sharika_family_members WHERE user_uid=NEW.applicant_uid);
END;
CREATE TRIGGER IF NOT EXISTS sharika_family_request_reopened_audit
AFTER UPDATE OF state ON sharika_family_join_requests
WHEN OLD.state!='pending' AND NEW.state='pending'
BEGIN
  INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json)
    VALUES(NEW.family_id,NEW.applicant_uid,NEW.applicant_uid,'request_reopened',
      json_object('previous_state',OLD.state,'request_id',NEW.id));
END;

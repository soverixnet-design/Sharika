-- Backfill discoverable CP/Friendship invitation receipts for existing pending
-- invites. This is additive and does not touch bonds, coins, diamonds or gifts.
INSERT OR IGNORE INTO sharika_notifications
  (recipient_uid,kind,title,body,dedupe_key,created_by)
SELECT i.recipient_uid,'event',
  CASE i.type WHEN 'cp' THEN 'CP invitation received'
    ELSE 'Friendship invitation received' END,
  'Member '||printf('%08d',sender.public_no)||
  ' sent a '||gift.name||' invitation ('||
  CAST(i.held_coins AS TEXT)||
  ' coins). Open CP / Friends Invitations to accept or decline.',
  'bond_invite_received:'||i.id,i.sender_uid
FROM sharika_bond_invites i
JOIN sharika_users sender ON sender.auth_uid=i.sender_uid
JOIN sharika_users recipient ON recipient.auth_uid=i.recipient_uid
JOIN sharika_bond_gifts gift ON gift.id=i.gift_id
WHERE i.status='pending' AND i.expires_at_ms>unixepoch('now')*1000
  AND recipient.status='active' AND sender.status='active';

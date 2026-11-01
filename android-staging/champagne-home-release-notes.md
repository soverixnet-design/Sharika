# Sharika Champagne Gold Home (Option 2)

This Android staging build packages the owner's selected champagne-gold background and coordinated 3D quick-action icons. The home shortcut row has Daily reward, Games, and Invite; Recharge moves into a small button beside the header balance. The Shop and Backpack remain available from their other routes, without duplicate Home shortcuts.

Room discovery has Popular, New, My room, and History. The viewer's registered account country is used for local-first sorting. A room's badge uses the owner's registered account country, not the viewer's phone location. The list still includes international rooms after the local ones.

History remembers the last 40 unique rooms the authenticated user successfully entered on this device; entries are separated by verified account ID. This history is not yet cross-device synced.

The staging Cloudflare Worker must return `owner_country` from its joined `sharika_users` data. Deploy that audited read-only route update separately before relying on country flags in real room discovery.

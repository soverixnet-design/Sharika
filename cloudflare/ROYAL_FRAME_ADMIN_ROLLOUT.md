# Sharika Royal Role frame and SVIP grant rollout (staging only)

The animations are packaged **inside the Android staging APK**. The Worker
catalogue is the sole authority for ownership; APK preview does not grant a
frame, medal, role or any admin permission.

## What the Super Admin sees

1. Sign in to the verified staging Admin Panel and open **Frames, Entry & Name Tags**
   (or Store / Medals).
2. At the **top** of the page, enter the recipient's verified eight-digit
   Sharika public ID.
3. Select Frames or Medals, search by name (`Role Frame 28`, `SVIP Medal 3`),
   select the exact item, then tap **Give selected item to ID · Free**.
4. Confirm the recipient and item. The existing server checks the Super Admin
   role and records an audited, idempotent inventory grant. The user may equip
   the owned style from the Android profile; grants do **not** auto-equip or
   alter wallet coins.
5. The bundled Royal Role images sometimes contain a role label. The art is
   decorative and cannot give a recipient server-side staff permissions.

## Server prerequisites

As inspected on 1 November 2026, `sharika-staging` had only 14 ordinary frames
and no bundled Royal Role or SVIP frames in `sharika_cosmetics_catalog`; its
`d1_migrations` table ended at `0033_notifications.sql`. The required additive
catalogue migrations are:

- `0034_svip_animated_assets.sql`: 35 VIP/SVIP/Noble animations, inactive.
- `0035_cp_weekly_rewards.sql`: unrelated, **disabled** CP weekly receipts;
  required only when applying all pending migrations in filename order.
- `0036_royal_role_frame_catalog.sql`: 62 Royal Role frames, inactive.

Do not run an unreviewed `d1 migrations apply --remote` or rebuild the D1
database. **Back up the exact staging database, compare the migration journal
and schema, and apply only reviewed additive migrations in order.** A previous
checkpoint identified migration-journal drift; that warning still matters.
Verify the 97 bundled items are in the catalogue before announcing they are
available for grants. Newly seeded items are **not** open to coin purchases
unless Super Admin explicitly enables them.

The staging Admin Worker embeds `admin/connection.js` into its compiled script.
An Android APK build or GitHub push does **not** update that Worker. Deploy a
reviewed `sharika-admin-staging` bundle with its existing `SHARIKA_API` service
binding, separately from the API Worker, and verify the authenticated Grant
flow against a test account before using real recipients.

The mobile Firebase Google login popup problem is separate from this catalogue
rollout. Do not bypass Firebase authentication or the Super Admin D1 role check.

## Validation

Run `cd cloudflare && npm run check`. The role-frame tests execute actual
SQLite migrations, verify all 97 packaged animations, default-inactive items,
and an audited Super Admin-only inventory grant with **no wallet update**.
Also visually check the Android frame selector, profile avatar and seat frame
in the emulator and on a phone before releasing to users.

# Agency / BD / Host design QA

Source: user-supplied three black/gold mobile screenshots; fourth image used as role-icon subject reference.

## Browser preview evidence

- BD Center: title, performance hero, assigned Agency list with emblems, detailed agency navigation.
- Agency: counts, gift total, roster, ID/name search, active/review filter, invite/assign action.
- Host Earnings: avatar, role, date periods, estimated salary, qualifying gifts, activity, salary statement, wallet transaction drill-down.
- Back navigation from Coin Transactions returns to Host Earnings.
- Responsive constrained width and sticky four-tab bottom nav visually inspected in Chrome.
- 4 Nov refinement: deeper bevels, raised gold numbers and emblems, gradient
  reflected highlights, three-dimensional profile frames and visible press states.
- Real verified **main public IDs** (eight digits) are used within privileged
  BD/Agency/Host dashboards, per the explicit user override. Existing public
  Special ID presentation rules outside this management area are unchanged.
- BD and Agency owner identity headers now bind to authenticated D1 names,
  `pic` URLs and original eight-digit IDs. Host roster uses the same verified
  images and IDs, and highlights today's server-calculated room time.
- Host Earnings shows today's/weekly/monthly activity plus up to 31 UTC daily
  activity rows and grouped per-room time. BD and Agency owner dashboards
  include collapsible daily room activity.
- Visual browser review confirmed BD Center -> Agency -> Host Earnings routes,
  gold cards, daily time and room rows, with clearly marked **sample data**.

## Differences and limits

- Decorative ornaments are adapted to existing Sharika royal gold assets instead of screenshot-exact backgrounds.
- Preview uses explicitly labelled sample records; production app uses the authenticated native bridge and D1 APIs.
- Real device screenshot not captured, so Android font scaling, 360px narrow viewport, native back gesture, and photo framing remain to be checked.
- Room time starts tracking only after new migration `0060` has been applied
  and the matching Worker has been deployed; prior historical time is unknown.
  Heartbeats count at most 60 seconds of continuous same-room presence within
  one UTC date; an unobserved tail on leave/rollover is conservatively omitted.
- Native background WebView heartbeats may be suspended by the OS; therefore
  the report is verified-observed presence, not guaranteed wall-clock time.
- Admin-set salary targets and actual wallet payouts remain unconfigured;
  estimated salary is marked pending admin verification.
- The new `0060` migration must run **before** the Worker release because
  Agency report queries reference its tables. Do not deploy Worker alone.
- `npm run check`: 492/492 Node tests passed and all selected D1 SQL checks,
  including UTC rollover, room switch, duplicate heartbeat, offline gap,
  retention after room removal, and wallet isolation.

**final result: blocked** — browser interaction QA passed, but screenshot-exact native Android validation requires an APK/device build not available here.

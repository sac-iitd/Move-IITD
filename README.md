# MoveIITD — SAC Bus Booking (IIT Delhi ↔ Sonipat)

Seat booking for the Student Affairs Council shuttle between IIT Delhi's Delhi campus and the
Sonipat campus, served at **https://sac.iitd.ac.in/MoveIITD/**. Users sign in with **KEBROS**
(IIT Delhi OAuth 2 / Kerberos), book seats for themselves or a guest, join a waiting list when a
trip is full, and get emails for every change. Admins manage the timetable, holidays, special
buses, bookings, blocked users, driver passenger lists, email delivery, analytics and an audit log.

| Layer    | Stack                                                                       |
| -------- | --------------------------------------------------------------------------- |
| Web      | React 18 + TypeScript, Vite 7, Tailwind CSS 4, React Router, TanStack Query |
| API      | Node.js ≥ 20, Express 5 + TypeScript, Zod, Pino                             |
| Database | Prisma 6 — SQLite (dev/tests), MySQL 8 (production)                         |
| Auth     | IIT Delhi OAuth 2 (`oauth2.iitd.ac.in`), server-side sessions               |
| Email    | Nodemailer over IITD SMTP, transactional outbox with retries                |
| Tests    | Vitest, Supertest, React Testing Library — run on SQLite **and** MySQL 8.4  |

```
apps/web          React app (public/sac-logo.png = SAC crest; .env.production = /MoveIITD/ build)
apps/api          Express API (routes, bookings, auth, email, admin, blocks)
packages/shared   Zod schemas, DTO types, constants, Asia/Kolkata schedule rules
prisma/           schema.prisma (SQLite, source of truth), migrations/, mysql/ (generated), seed.ts
scripts/          create-admin, generate-trips, verify-smtp, build-mysql-schema, test-mysql
```

---

## Rules (decided by SAC, Oct 2026)

All times are **Asia/Kolkata (IST)**. Enforced by the API; the UI only mirrors them.

| Rule              | Value                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service days      | Monday–Friday (regular). Admins can add **special buses** on any day and **stop buses on holidays**.                                                                                          |
| Booking opens     | 7 calendar days before travel, 00:00 IST                                                                                                                                                      |
| Booking closes    | 4:00 PM IST the **working day before** travel: **Monday trips close Friday 4:00 PM**. Special buses close the calendar day before.                                                            |
| Self-cancellation | until **2:00 PM IST** on that same day (Friday for Monday trips); booking stays open until 4 PM                                                                                               |
| Seats per account | max **2 per trip** (confirmed + waitlisted), any mix of self and guests; at most one for yourself                                                                                             |
| Waiting list      | when a trip is full; on a cancellation the **first person is auto-confirmed** and emailed; promotion runs until booking closes (4 PM the day before); leftover entries are closed and emailed |
| Booking details   | phone (10-digit Indian mobile, prefilled), purpose (Academic / Administrative / Other institutional activity + description)                                                                   |
| Guests            | name, email (gets copies of the mails), ID type (Aadhaar / PAN) + number, optional phone                                                                                                      |
| ID proof          | self: IIT Delhi ID card (number = Kerberos id); guests: Aadhaar/PAN, **stored encrypted**, full number shown only to admins (driver list, export — every view audited)                        |
| Data retention    | phone numbers, guest emails and ID numbers are erased **180 days** after the trip                                                                                                             |
| Vehicles          | Bus 1 → **BUS** (24 seats), Bus 2 → **VAN** (13 seats)                                                                                                                                        |
| 1:30 PM VAN       | confirmed as 1:30 PM                                                                                                                                                                          |
| Admins            | `dgssac`, `sec_officer`, `securityofficer`, `deansonipat`, `eoasecurity`, `eoatransport`, `eoahtra`, `cs5240081` (Kerberos id or `@iitd.ac.in` email)                                        |

| Vehicle | Departure | Route           | Seats |
| ------- | --------- | --------------- | ----- |
| BUS     | 7:30 AM   | Delhi → Sonipat | 24    |
| BUS     | 5:30 PM   | Sonipat → Delhi | 24    |
| VAN     | 7:30 AM   | Sonipat → Delhi | 13    |
| VAN     | 10:00 AM  | Delhi → Sonipat | 13    |
| VAN     | 1:30 PM   | Sonipat → Delhi | 13    |
| VAN     | 5:00 PM   | Delhi → Sonipat | 13    |

Times, seats and deadlines are editable per departure in the admin portal.

---

## 1. Install

Node.js **20.11+**, npm 10+, and MySQL **8.0+** for production (tested on 8.4.11).

```bash
cd iitd-bus-booking
npm ci                      # also runs `prisma generate`
cp .env.example .env        # then fill it in (see §5 and the comments in the file)
```

> **Windows + Smart App Control:** Rollup's native binary can be blocked by Application Control;
> `package.json` overrides `rollup` with the official `@rollup/wasm-node`. No action needed.

## 2. Run locally (your laptop)

The local `.env` and `prisma/dev.db` already exist on this laptop (dev settings: SQLite, test
sign-in, emails saved to `.mail/`). Real KEBROS login only works on `sac.iitd.ac.in`.

```bash
cd D:\SEM7\SAC\iitd-bus-booking
npm run db:seed             # optional: tops up trips for the next 14 days (safe to rerun)
npm run dev                 # API :4000 + web :5173  →  open http://localhost:5173  (Ctrl+C to stop)
```

- "Sign in with KEBROS" shows **test identities**: Dev Student One/Two (users), **Dev Admin** (admin tab).
- Emails are not sent locally — open the `.eml` files in `.mail/` with Outlook/Thunderbird.
- **Fresh machine / fresh copy:** `npm ci`, `cp .env.example .env`, replace its values with the
  "LOCAL DEVELOPMENT" block at the bottom of that file, then `npx prisma migrate dev && npm run db:seed`.
- **Reset local data:** stop the server, delete `prisma/dev.db`, `npx prisma migrate dev && npm run db:seed`.
- Error **"the URL must start with the protocol `mysql://`"** → the generated client is the MySQL one
  (left by `npm run test:mysql`). Stop the dev server and run `npx prisma generate`.
- Error **"EPERM … query_engine"** or **"database is locked"** → another server is still running; stop it.
- Use the same kind of terminal each time: `node_modules` was installed with **Windows** Node.
  WSL works only if `npm` resolves to the Windows install (as it does now); never run `npm install`
  with WSL's Linux Node in this folder.

The dev-mock sign-in is refused at startup when `NODE_ENV=production`.

## 3. Database

`prisma/schema.prisma` is the single source of truth (SQLite). `npm run prisma:schema:mysql`
generates `prisma/mysql/schema.prisma`; both have committed migrations. A test fails if they drift.

**MySQL setup (production):**

```sql
CREATE DATABASE iitd_bus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bus_app'@'127.0.0.1' IDENTIFIED BY '<strong password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON iitd_bus.* TO 'bus_app'@'127.0.0.1';
```

```bash
npm run db:deploy:mysql     # generates the MySQL client + applies migrations (never resets data)
npm run db:seed
```

Back up before every `db:deploy:mysql`. Never run `migrate dev` / `migrate reset` on production.
The `20261013120000_passengers_waitlist_blocks` migration backfills existing bookings
(self passenger, purpose "Other"), renames Bus 1/2 to BUS/VAN and moves cancellation to 2 PM.

## 4. KEBROS (IIT Delhi OAuth 2)

Registered client: **"Nexus – SAC BusBooking Portal"** (sysadm@cc.iitd.ac.in, 13 Oct 2026),
Client ID (public, already in `.env.example`) `FUPav5pAyxYdvZTi8elrAAzJHn6dRvn1`,
Server URI `https://sac.iitd.ac.in`, Redirect URI
`https://sac.iitd.ac.in/MoveIITD/api/auth/iitd/callback`. The client **secret** is only in the
sysadm email — never in the repo. Client config page: https://oauth2.iitd.ac.in/client_config.php
(login required). Changes to the client: webgroup@cc.iitd.ac.in.

Flow (exactly as documented by IITD; `apps/api/src/auth/kebros.ts`):
`authorize.php?response_type=code&client_id&state` → callback with `code` + `state` →
server POSTs `client_id, client_secret, grant_type=authorization_code, code` to `token.php` →
server POSTs `access_token` to `resource.php` → `user_id, mail, name, category…`.
`state` is bound to a 10-minute signed HTTP-only cookie; the access token is never stored or logged.
Only `user_id` (identity key), name, email and category are kept.

IITD only shows the Kerberos page when the browser's `Referer` starts with the registered
Server URI (`https://sac.iitd.ac.in`). The sign-in redirect therefore sends
`Referrer-Policy: origin`. Without that header, `authorize.php` sends the user to the SAC
homepage instead of the login form.

## 5. Configuration (`.env` on the server)

`.env.example` is pre-filled for production. Fill these five placeholders:

| Variable                                             | What                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                       | MySQL password                                                                                  |
| `SESSION_SECRET`                                     | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`                |
| `KEBROS_CLIENT_SECRET`                               | from the sysadm email                                                                           |
| `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM_ADDRESS` | the IITD mailbox that sends the mails (any mailbox; usually From = that mailbox)                |
| `ID_ENCRYPTION_KEY`                                  | another random secret — **keep a safe copy**; without it stored guest ID numbers cannot be read |

The live file on the SAC server is `/var/www/sac/https/moveiitd/.env` (mode `600`, not in git).
People deploying from this checkout also keep a copy at `.env.production.local`, which `.gitignore`
already excludes. That is the file to open for `ID_ENCRYPTION_KEY` and the other server secrets.
Do not commit it.

The server refuses to start with missing/invalid settings and names the variable (never the value).

**SMTP** (from CSC): `smtp.iitd.ac.in`, auth required, SSL/TLS on 465 (default here) or STARTTLS on 25.
If TLS fails with a certificate error, download CSC's Entrust CA and set `SMTP_CA_FILE`.

```bash
npm run email:verify                         # connect + authenticate
npm run email:verify -- --to you@iitd.ac.in  # send a test message
```

## 6. Build & deploy at https://sac.iitd.ac.in/MoveIITD/

```bash
npm ci
npm run db:deploy:mysql && npm run db:seed
npm run build               # API → apps/api/dist, web → apps/web/dist (paths under /MoveIITD/)
cd apps/api && NODE_ENV=production node dist/server.js      # serves web + API on :4000
```

`SERVE_WEB_DIR=../web/dist` (already in `.env.example`) makes the one Node process serve the SPA
(strict self-only CSP) and the API. Background jobs (emails, trip generation, waitlist expiry,
data retention, session cleanup) run in the same process.

> The existing SAC website is static files in `/var/www/sac/https/html`. MoveIITD is **not static** —
> it needs the Node process running and Apache forwarding `/MoveIITD/` to it.

**Apache** (inside the existing `sac.iitd.ac.in` HTTPS VirtualHost; needs `mod_proxy`, `mod_proxy_http`, `mod_headers`):

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyPass        /MoveIITD/ http://127.0.0.1:4000/
ProxyPassReverse /MoveIITD/ http://127.0.0.1:4000/
RedirectMatch ^/MoveIITD$ /MoveIITD/
```

(The app also works if the proxy forwards `/MoveIITD/…` unstripped.) Keep `TRUST_PROXY=1`.

**Keep it running** — systemd (`/etc/systemd/system/moveiitd.service`):

```ini
[Unit]
Description=MoveIITD SAC Bus Booking
After=network.target mysql.service
[Service]
WorkingDirectory=/opt/moveiitd/apps/api
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
User=moveiitd
[Install]
WantedBy=multi-user.target
```

`systemctl enable --now moveiitd`. Health: `/MoveIITD/api/v1/health`; DB readiness: `/MoveIITD/api/v1/ready`.
Graceful shutdown on SIGTERM. Without root, `pm2 start dist/server.js --name moveiitd` also works.

**First live checks:** sign in as `dgssac` → admin tab visible and `ADMIN_SIGN_IN` in the audit log;
book a trip → confirmation email arrives; open a trip's _Passenger list_ and print it.

### Backups

```bash
# nightly (cron): 15 2 * * *
mysqldump --single-transaction --routines --triggers -u bus_backup -p"$PW" iitd_bus | gzip > /var/backups/moveiitd/$(date +%F).sql.gz
find /var/backups/moveiitd -name '*.sql.gz' -mtime +30 -delete
```

Back up `.env` (especially `ID_ENCRYPTION_KEY`) separately and securely. **Restore:** stop the
service, restore the dump into a new database, point `DATABASE_URL` at it, `npm run db:deploy:mysql`, start.

## 7. Admin portal (`/MoveIITD/admin`)

- **Overview** — today's trips, bookings, seats filled/left, trips at capacity, per-trip load.
- **Trips & schedule** — edit departures (time, seats, deadlines; changes apply to future trips,
  booked trips are never silently changed), **holidays** (stop all regular buses on a date →
  passengers emailed, no trips generated), **special buses** (any date incl. weekends, custom
  deadline for short notice), cancel a trip, **passenger list** per trip (print or CSV for the driver:
  S.No, name, phone, purpose, ID type, ID number, signature).
- **Bookings** — search (reference, name, email, Kerberos id), filters, waitlist positions,
  passenger/ID details, cancel with reason (seat goes to the waitlist), CSV export with full details.
- **Analytics** — occupancy, bookings per day, occupancy by departure and weekday, direction split,
  booking lead time (charts with table views).
- **Users & blocks** — block a user for a date range with a reason (their bookings in that period are
  cancelled and emailed; they're told until when), lift a block early.
- **Email** — delivery status, retry failed messages. **Audit log** — every admin action, ID-number view and export.

Admin rights come only from `ADMIN_ALLOWLIST` or the CLI:

```bash
npm run admin:create -- --subject <kerberos-id>            # grant
npm run admin:create -- --subject <kerberos-id> --revoke   # revoke
npm run admin:create -- --list
```

## 8. Tests

```bash
npm test             # 17 shared + 139 API + 27 web
npm run typecheck && npm run lint && npm run format:check
MYSQL_TEST_URL="mysql://user:pass@127.0.0.1:3306" npm run test:mysql   # whole API suite on MySQL (new DB per run)
```

Covered: booking windows and IST boundaries, Friday 4 PM / 2 PM cutoffs for Monday trips, capacity under concurrent
requests (HTTP and parallel DB connections), the 2-seat limit under parallel requests, waitlist
promotion/expiry, guest ID encryption, blocks, holidays, special buses, manifest/export auditing,
data retention, KEBROS client, sessions/CSRF, admin authorization on every endpoint, emails.

## Troubleshooting

| Symptom                                   | Check                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| API exits "Invalid configuration"         | the message names the variables; compare with `.env.example`                    |
| Sign-in `state_expired` / loops           | cookies blocked, flow >10 min, or `WEB_ORIGIN`/`APP_BASE_PATH` wrong            |
| `provider_error` / `provider_unavailable` | client secret / redirect URI; outbound HTTPS to `oauth2.iitd.ac.in`             |
| Emails stay "pending"                     | Admin → Email shows the error; `npm run email:verify`; try `SMTP_CA_FILE`       |
| Blank page / 404 assets                   | Apache rule for `/MoveIITD/`; rebuild after changing `apps/web/.env.production` |
| "A newer version is available"            | a deploy replaced old files; users just reload                                  |

## Project context (for resuming work later)

**Where things stand (13 Oct 2026):** all features built; 183 tests pass (also on MySQL 8.4);
production build verified under `/MoveIITD/`. Not yet done: live KEBROS sign-in and real SMTP send
(need the deployed server), a visual click-through of the newer screens in a browser, deployment.
**Nothing is committed to git yet** — run `git add -A && git commit` before big changes.
Original brief: `plan.md` (later SAC decisions in the Rules table above override it).

**To continue with an AI assistant**, start with: _"Read README.md (esp. Rules and Project context)
in D:\SEM7\SAC\iitd-bus-booking, then …"_.

**Key design decisions** (don't undo without a reason):

- Seats are claimed by one atomic `UPDATE trip SET bookedCount = bookedCount + 1 WHERE … AND bookedCount < capacity`
  inside the booking transaction — safe on SQLite and MySQL. After a failed claim, a re-read under
  MySQL REPEATABLE READ can be stale, so it is treated as FULL (`apps/api/src/bookings/service.ts`).
- 2-seat limit = unique `(userId, tripId, activeSlot ∈ SEAT1/SEAT2)` + `(userId, tripId, selfSlot = SELF)`;
  cancelling sets both slots to the booking id (history kept, rebooking allowed).
- Waitlist = bookings with status `WAITLISTED`; `promoteWaitlist()` runs after cancellations and
  capacity increases; `expireWaitlists()` job closes leftovers after 4 PM the day before.
- Emails use a transactional outbox (row written in the same DB transaction; dedupe key per
  recipient; retries with backoff; guests get `:guest` copies). Templates: `apps/api/src/email/templates.ts`.
- Guest ID numbers: AES-256-GCM (`apps/api/src/lib/id-cipher.ts`), key from `ID_ENCRYPTION_KEY`.
- Sessions: random token in HTTP-only cookie (`__Host-` in prod), only its SHA-256 stored; CSRF token
  header + Origin check; OAuth `state` in a signed cookie; admin role re-read on every request.
- Trips snapshot their template (time/seats/deadlines); template edits only affect future trips.
- Sub-path: API accepts `/MoveIITD/...` with or without proxy stripping (`APP_BASE_PATH`); web base path
  is in committed `apps/web/.env.production`.
- Production refuses to start without KEBROS settings, `ID_ENCRYPTION_KEY`, SMTP and an https origin.

**Code map:** API `apps/api/src/` — `routes/` (auth, trips, bookings, admin, schedule), `bookings/`
(service, dto, notify), `blocks/`, `admin/service.ts` (trips, templates, closures, special buses),
`email/` (outbox, worker, templates, mailer), `trips/` (generation, seed), `jobs.ts`, `config/env.ts`.
Web `apps/web/src/` — `pages/`, `components/` (BookTripDialog, TripCard, Feedback, ErrorBoundary),
`admin/` (Trips, Bookings, Analytics + `charts.tsx`, Users, Manifest, ScheduleExtras), `api/client.ts`.
Shared rules/types: `packages/shared/src/` (`schedule.ts` = IST windows, `api.ts` = schemas/DTOs).
Schema changes: edit `prisma/schema.prisma` → `npx prisma migrate dev --name x` → `npm run prisma:schema:mysql`
→ write the matching MySQL migration in `prisma/mysql/migrations/` (see §3).

**This machine's quirks:**

- Smart App Control blocks Rollup's native binary → `rollup` is overridden with `@rollup/wasm-node`.
- Git Bash rewrites values like `/MoveIITD/` into Windows paths — keep the base path in `.env.production`.
- Prisma refuses `migrate reset` when run by an AI agent → MySQL tests use `migrate deploy` on a fresh DB.
- Prisma can't rewrite its engine while a server is running (EPERM) — stop `npm run dev` first.
- Optional local MySQL 8.4 for `test:mysql`: WSL Ubuntu, `~/mysql-test`, port 3307, user `bus`
  (non-root tarball install; start it again after a reboot).

**Security reminders:** the Kerberos/SSH password appeared in plain text in `D:\SEM7\SAC\update.md`
and `deploy_on_server.jpg` — change it and delete those copies. Consider asking sysadm to re-issue the
OAuth client secret before launch (it was shared in notes/chat). Never commit `.env`; keep a safe copy
of `ID_ENCRYPTION_KEY`.

## Status

| Area                                                                           | Status                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Booking rules, waitlist, guests, 2-seat limit, blocks, holidays, special buses | ✅ done, tested on SQLite + MySQL 8.4                                                    |
| Admin portal incl. analytics, driver list, CSV, audit                          | ✅ done, server-side authorization tested                                                |
| Emails (booking, cancellation, waitlist, trip cancellation, block)             | ✅ done (file transport tested) · ⏳ real IITD SMTP send pending server `.env`           |
| KEBROS login                                                                   | ✅ implemented to the IITD docs · ⏳ live test pending deployment on sac.iitd.ac.in      |
| Loading screen, transitions, offline/server-down/error fallbacks               | ✅ done                                                                                  |
| Deployment on the SAC server                                                   | ⏳ you deploy (§6)                                                                       |
| Known advisory                                                                 | `npm audit`: `deepmerge-ts` inside the Prisma CLI config loader (migration tooling only) |

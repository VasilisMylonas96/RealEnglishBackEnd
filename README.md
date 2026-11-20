# Real English Academy — Backend API

Node.js + Express + Prisma (PostgreSQL) API gateway for the Real English React frontend.

## Quick start

```bash
npm install
cp .env.example .env                  # then fill in DATABASE_URL (Neon) + secrets
npx prisma migrate deploy             # applies the PostgreSQL schema to your DB
npx prisma generate                   # (re)generates the Prisma client
npm run seed                          # seeds admin (mariaMarkou/123) + default content
npm run questions:fill                # fills the bank to 100,000 levelled questions
npm run dev                           # starts on http://localhost:4000
```

> **Database:** this backend uses **PostgreSQL** (e.g. Neon). Set `DATABASE_URL`
> in `.env` to your Neon connection string before running migrations. The
> schema lives in `prisma/schema.prisma` and the migration in
> `prisma/migrations/20261120000000_init/`.

The question-bank command adds original, template-generated questions balanced
across the six student levels and three difficulty tiers, then diversifies the
generated bank across multiple question types. To convert an existing generated
bank without adding rows, run
`node prisma/fill-question-bank.js --diversify-only`. Preview missing question
generation without writing to the database with
`node prisma/fill-question-bank.js --dry-run`.

`npm run dev` runs the backend in the foreground. Stop it with `Ctrl+C` in that
terminal; closing the terminal also ends its foreground process. Do not start a
second backend on the same port. Production (`npm start`) also reports a clear
error if its configured port is occupied.

Tournament matches use sudden-death questions if both players tie after the
standard round or final. Each tiebreaker question is shared by both players and
the match continues until exactly one player answers correctly. Apply pending
database changes with `npx prisma migrate deploy` before starting the backend.

Quiz questions display a locally generated, topic-themed cartoon illustration.
Quiz feedback and tournament ambience/result cues are synthesized in the
browser; the sound control in the quiz player can mute or enable them.

Teacher/Admin users can manage the paginated question bank at
`/admin/quiz-questions`. The API supports question search, editing, bulk save,
and per-mode scanned-question settings under `/api/quiz-questions`. Apply the
question-bank migration with `npx prisma migrate deploy` before using these
features.

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | — | Login, returns JWT + sets HTTP-only cookie |
| POST | `/api/auth/logout` | — | Clears cookie |
| GET | `/api/auth/me` | JWT | Current user |
| GET | `/api/content/:page` | — | Page content elements |
| PUT | `/api/content/update` | ADMIN | Upsert page content |
| GET | `/api/media/:gallery_id` | — | Media URL list |
| POST | `/api/media/upload` | ADMIN | Upload image (multipart `file` + `gallery_id`) |
| DELETE | `/api/media/:id` | ADMIN | Delete media record + file |
| GET | `/uploads/*` | — | Static optimized WebP files |
| GET | `/api/video-calls` | TEACHER | List video calls (admin: all, teacher: own) |
| GET | `/api/video-calls/room/:jitsiRoomId` | JWT | Resolve a call room (invited users only) |
| POST | `/api/video-calls/room/:jitsiRoomId/join` | JWT | Mark call ACTIVE when host joins |
| POST | `/api/video-calls/room/:jitsiRoomId/end` | JWT | End a call (host/admin only) |
| POST | `/api/video-calls/:sessionId/resend` | TEACHER | Resend invite emails to invited students |
| GET | `/api/notifications` | JWT | Current user's notifications + unread count |
| POST | `/api/notifications/:id/read` | JWT | Mark one notification as read |
| POST | `/api/notifications/read-all` | JWT | Mark all notifications as read |

## Configuration

See `.env.example` — `PORT`, `CORS_ORIGIN`, `JWT_SECRET`, `DATABASE_URL`
(PostgreSQL/Neon), `PUBLIC_BASE_URL`, `APP_BASE_URL`, `FRONTEND_URL`,
`UPLOADS_DIR` (optional), `GEMINI_API_KEY`, `GOOGLE_PLACES_API_KEY`, and the
SMTP mail settings (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`,
`MAIL_FROM`).

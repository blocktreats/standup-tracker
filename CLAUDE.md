# Standup Tracker — Project Context

## What This Is

A Google Meet side-panel add-on that tracks who has done their standup. Opens inside Meet via the Activities panel (puzzle piece icon). Participants are auto-populated from the Meet API, and anyone with the add-on open can tap names to mark them as done. State syncs in real-time across all users via Supabase.

## Architecture

```
[Meet Side Panel iframe]  →  [Vercel Static Files (public/)]
        |                              |
        | GET /api/participants        | Supabase Realtime (Postgres Changes)
        v                              v
[Vercel Serverless Function]    [Supabase: meetings table]
        |                         id (text PK), data (jsonb), updated_at
        | Service Account + DWD
        v
[Google Meet REST API v2]
```

### Key Components
- **Frontend**: Pure HTML/JS/CSS in `public/` — no framework, no build step
- **Backend**: Single Vercel serverless function at `api/participants.js`
- **Auth**: Google Service Account with domain-wide delegation (server-side, no user-facing OAuth)
- **Database**: Supabase `meetings` table with JSONB `data` column, RLS enabled (anonymous read/write)
- **Real-time**: Supabase Postgres Changes subscription per meeting ID
- **Meet SDK**: Used only for getting meeting ID and meeting code from inside the iframe

### Data Model
```json
{
  "participants": {
    "google-12345": { "name": "Alice Smith", "done": false },
    "meet-bob-jones": { "name": "Bob Jones", "done": true }
  },
  "startedAt": 1773340000000
}
```

## Credentials & Config

- **Supabase**: URL and anon key in `public/config.js`
- **Google Cloud Project**: 650342594013
- **Service Account**: Configured with domain-wide delegation for `meetings.space.readonly` scope
- **Vercel Env Vars**: `GOOGLE_SERVICE_ACCOUNT_KEY` (full JSON key), `GOOGLE_IMPERSONATE_EMAIL` (Workspace user email)
- **Hosting**: standup-tracker-three.vercel.app
- **Repo**: github.com/blocktreats/standup-tracker

## Deployed Add-on Manifest

The Meet add-on is registered in Google Workspace Marketplace SDK as an HTTP deployment. The manifest points `sidePanelUrl` to the Vercel-hosted `sidepanel.html`.

## Design

- Dark theme matching Google Meet's background (#1b1b1b)
- Datalinks.com blue color scheme (accent: #0ba5ec)
- Capybara mascot icons (capy-su.png for branding, capy.png unused currently)
- Inter font, glassmorphism effects, animated progress bar

## What's Been Built

1. Supabase table + RLS policies (`supabase-setup.sql`)
2. Side panel HTML with loading state, header, participant list, action footer
3. CSS with dark theme, animations, check toggles, progress bar
4. Frontend JS: Supabase init, Meet SDK init, real-time subscription, render loop, tap-to-toggle
5. Backend serverless function: service account auth → Meet API → participant list
6. Manual participant add (text input) as fallback when Meet API unavailable
7. Timer (starts on "Start Standup", shows elapsed time)
8. Vercel deployment configured with `outputDirectory: "public"` and `api/` serverless functions

## What's NOT Built Yet (Pending Decisions)

- **External org distribution**: See `EXTERNAL-ORG-SETUP.md` for options. Needs decision on Marketplace listing approach + per-org auth flow.
- **Automatic speech detection**: Would require a bot joining via headless browser + speech-to-text API with speaker diarization. User wants this but it's a large project.
- **Force-open add-on**: Not possible via Google Meet APIs. Each user must manually open it from Activities panel.

## User Preferences

- Wants zero-friction UX — no sign-in prompts, no manual steps for participants
- Runs standups with ~10 people on Google Meet
- The core problem: tracking who has/hasn't spoken during standup
- Prefers the app to work without requiring every participant to open it
- Datalinks.com branding (dark blue color scheme)
- Capybara mascot icons for personality

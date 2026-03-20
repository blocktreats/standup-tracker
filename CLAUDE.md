# Standup Tracker (WorkUp) — Project Context

## What This Is

A Google Meet side-panel add-on that tracks who has done their standup. Opens inside Meet via the Activities panel (puzzle piece icon). Participants are auto-populated from the Meet API, and anyone with the add-on open can tap names to mark them as done. State syncs in real-time across all users via Supabase.

## Architecture

```
[Meet Side Panel iframe]  →  [Vercel Static Files (public/)]
        |                              |
        | GET /api/participants        | Supabase Realtime (Postgres Changes)
        v                              v
[Vercel Serverless Functions]    [Supabase: meetings + org_tokens tables]
        |
        | 1. Try service account (your org)
        | 2. Try stored OAuth tokens (external orgs)
        v
[Google Meet REST API v2]

[/setup.html]  →  Google OAuth  →  [/api/auth/callback]  →  Supabase org_tokens
```

### Key Components
- **Frontend**: Pure HTML/JS/CSS in `public/` — no framework, no build step
- **Backend**: Vercel serverless functions in `api/`
  - `api/participants.js` — fetches meeting participants (tries service account, then org tokens)
  - `api/auth/callback.js` — OAuth callback for external org onboarding
  - `api/_lib/google-auth.js` — service account auth (your org)
  - `api/_lib/oauth-tokens.js` — OAuth token management (external orgs)
- **Auth (your org)**: Google Service Account with domain-wide delegation (server-side, no user-facing OAuth)
- **Auth (external orgs)**: OAuth 2.0 refresh tokens stored in Supabase per org domain
- **Database**: Supabase with two tables:
  - `meetings` — JSONB `data` column, RLS open (anonymous read/write)
  - `org_tokens` — refresh tokens per org domain, RLS locked (service role only)
- **Real-time**: Supabase Postgres Changes subscription per meeting ID
- **Meet SDK**: Used only for getting meeting ID and meeting code from inside the iframe
- **Setup page**: `public/setup.html` — standalone OAuth flow for external orgs

### Data Model
```json
// meetings table
{
  "participants": {
    "google-12345": { "name": "Alice Smith", "done": false },
    "meet-bob-jones": { "name": "Bob Jones", "done": true }
  },
  "startedAt": 1773340000000
}

// org_tokens table
{
  "domain": "acme.com",
  "email": "admin@acme.com",
  "refresh_token": "1//...",
  "access_token": "ya29...",
  "token_expires_at": "2026-03-19T..."
}
```

## Credentials & Config

- **Supabase**: URL and anon key in `public/config.js`
- **Google Cloud Project**: 650342594013
- **Service Account**: Configured with domain-wide delegation for `meetings.space.readonly` scope
- **OAuth Client**: Web application type, client ID in `public/config.js`, secret in Vercel env vars
- **Vercel Env Vars**:
  - `GOOGLE_SERVICE_ACCOUNT_KEY` — full JSON key for service account
  - `GOOGLE_IMPERSONATE_EMAIL` — Workspace user email for DWD
  - `GOOGLE_OAUTH_CLIENT_ID` — OAuth 2.0 client ID
  - `GOOGLE_OAUTH_CLIENT_SECRET` — OAuth 2.0 client secret
  - `SUPABASE_URL` — Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (bypasses RLS)
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

1. Supabase tables + RLS policies (`supabase-setup.sql`, `supabase-org-tokens.sql`)
2. Side panel HTML with loading state, header, participant list, action footer
3. CSS with dark theme, animations, check toggles, progress bar
4. Frontend JS: Supabase init, Meet SDK init, real-time subscription, render loop, tap-to-toggle
5. Backend serverless function: service account auth → Meet API → participant list
6. Multi-org participant fetching: OAuth token storage + per-org token rotation
7. OAuth setup page for external org onboarding (`/setup.html`)
8. OAuth callback endpoint (`/api/auth/callback`)
9. Manual participant add (text input) as fallback when Meet API unavailable
10. Timer (starts on "Start Standup", shows elapsed time)
11. Privacy policy and terms of service pages
12. Vercel deployment configured with `outputDirectory: "public"` and `api/` serverless functions

## What's NOT Built Yet

- **Marketplace listing**: Need to configure the listing in Google Cloud Console and submit for review
- **OAuth consent screen verification**: Required for external users — submit to Google
- **Automatic speech detection**: Would require a bot joining via headless browser + speech-to-text API with speaker diarization. User wants this but it's a large project.
- **Force-open add-on**: Not possible via Google Meet APIs. Each user must manually open it from Activities panel.

## User Preferences

- Wants zero-friction UX — no sign-in prompts, no manual steps for participants
- Runs standups with ~10 people on Google Meet
- The core problem: tracking who has/hasn't spoken during standup
- Prefers the app to work without requiring every participant to open it
- Datalinks.com branding (dark blue color scheme)
- Capybara mascot icons for personality

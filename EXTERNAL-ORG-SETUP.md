# External Organization Setup Guide

## How Multi-Org Works

WorkUp supports any Google Workspace organization. There are two things an external org needs:

1. **Install the add-on** — so it appears in their Google Meet
2. **Connect their account** — so WorkUp can auto-detect meeting participants

## Step 1: Install the Add-on

### Option A — Unlisted Marketplace Listing (recommended)
- Share a direct install link with the org's Workspace admin
- Not searchable in the public Marketplace
- Lighter Google review process
- **Status**: Needs to be configured in Google Cloud Console

### Option B — Public Marketplace Listing (wider reach)
- Searchable in the Google Workspace Marketplace
- Requires full Google review: privacy policy, terms of service, OAuth consent screen verification
- The `meetings.space.readonly` scope is considered sensitive — review can take days/weeks

### Option C — Manual Install (no Marketplace)
- The external org creates their own Google Cloud project
- They add the same HTTP deployment manifest pointing to your Vercel URL
- No Marketplace listing needed, but requires technical setup on their end

## Step 2: Connect Their Account

1. One person from the external org visits **https://standup-tracker-three.vercel.app/setup.html**
2. They click "Connect with Google" and sign in with their Workspace account
3. They grant the `meetings.space.readonly` permission
4. WorkUp stores a refresh token for their org domain
5. From then on, WorkUp can auto-detect participants in any meeting where that person is present

### Important
- The connected person must be **present in the meeting** for auto-detect to work (Google API limitation)
- Only one person per org needs to connect
- If the connected person leaves the org, someone else should re-connect

## How Participant Fetching Works

When someone opens the add-on in a meeting:

1. The frontend sends the meeting code to `/api/participants`
2. The backend first tries the **service account** (works for your org's meetings)
3. If no results, it tries each **stored OAuth token** from external orgs
4. The first token that finds the conference record returns the participant list
5. If no token works, participants can still be added manually

## Setup Checklist (for you, the app owner)

### Google Cloud Console
- [ ] Create OAuth 2.0 Client ID (Web application type)
  - Go to: APIs & Services > Credentials > Create Credentials > OAuth client ID
  - Application type: Web application
  - Authorized redirect URI: `https://standup-tracker-three.vercel.app/api/auth/callback`
- [ ] Configure OAuth consent screen for External users
  - Go to: APIs & Services > OAuth consent screen
  - User type: External
  - Add scope: `meetings.space.readonly`
  - Add scopes: `email`, `profile` (for identifying the user's org)
  - Fill in app name, logo, privacy policy URL, terms of service URL
- [ ] Submit for Google verification (required for external users)

### Vercel Environment Variables
- [ ] `GOOGLE_OAUTH_CLIENT_ID` — from the OAuth client you just created
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET` — from the OAuth client you just created
- [ ] `SUPABASE_URL` — your Supabase project URL (e.g. `https://xyz.supabase.co`)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Dashboard > Settings > API > service_role

### Frontend Config
- [ ] Update `oauthClientId` in `public/config.js` with the OAuth client ID

### Supabase
- [ ] Run `supabase-org-tokens.sql` in the SQL Editor to create the `org_tokens` table

### Marketplace Listing
- [ ] Configure listing in Google Workspace Marketplace SDK
- [ ] Submit for review (if public listing)

## Google's Fundamental Limitations

- The Meet REST API only returns meetings the authenticated user participated in
- The Meet Add-ons SDK only provides meeting ID/code — no participant list
- There is no API key, anonymous, or admin-level access to meeting participant data
- OAuth popups are blocked inside the Meet add-on iframe (it runs in a sandboxed iframe)
- There is no way to force-open an add-on for all meeting participants
- There is no API for real-time speech/audio detection — only a bot joining via headless browser could do this

## Cost

- Vercel: Free tier covers serverless functions for low usage
- Supabase: Already subscribed
- Google Workspace Marketplace: Free to list
- OAuth consent screen verification: Free but takes time

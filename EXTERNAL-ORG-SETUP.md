# External Organization Distribution — Options & Setup

## Current State

The standup tracker works end-to-end for your own org:
- Meet add-on installed via Google Workspace Marketplace SDK (HTTP deployment)
- Backend serverless function on Vercel fetches participant names via Google Meet REST API v2
- Uses a service account with domain-wide delegation, impersonating a user in your org
- Auto-populates names for any meeting where the impersonated user is a participant
- Real-time sync via Supabase so anyone who opens the add-on sees the same checklist

## The Two Things External Orgs Need

### 1. Install the Add-on

This makes the side panel available in Google Meet for their org.

**Option A — Unlisted Marketplace Listing (easier)**
- Share a direct install link; not searchable in the public Marketplace
- Requires basic listing info (name, description, icons) but lighter review process
- Setup: Google Cloud Console → Google Workspace Marketplace SDK → App Configuration

**Option B — Public Marketplace Listing (wider reach)**
- Searchable in the Google Workspace Marketplace
- Requires full Google review: privacy policy, terms of service, OAuth consent screen verification
- The `meetings.space.readonly` scope is considered sensitive — verification can take days/weeks

**Option C — Manual Install (no Marketplace)**
- An admin at the external org creates their own Google Cloud project
- They add the same HTTP deployment manifest pointing to your Vercel URL
- No Marketplace listing needed, but requires technical setup on their end

### 2. Authorize Participant Fetching

The Meet API only returns participants for meetings the authenticated user participated in. No admin-level "see all meetings" access exists. So each org needs a user who:
- Has authorized the app
- Is present in the meetings where participant auto-fetch is needed

**Current setup (your org only):**
- Service account + domain-wide delegation impersonates a user in your domain
- Only works for your org — can't impersonate users in other domains

**Multi-org approach — One-time OAuth setup page:**
- Build a `/setup` page on your Vercel (standard web page, NOT inside Meet iframe)
- One person from the external org visits this page and clicks "Sign in with Google"
- They complete the standard Google OAuth consent flow
- Your backend stores their refresh token in Supabase, keyed to their org/email
- When the add-on calls `/api/participants`, the backend looks up the stored token for that meeting's org
- Falls back to your service account for your own org's meetings

**What this requires you to build:**
- A `/setup` authorization page (public/setup.html + OAuth redirect handling)
- A `tokens` table in Supabase to store refresh tokens per org
- Update `api/participants.js` to look up per-org tokens
- Switch from service account to OAuth client credentials (client ID + client secret)
- Get the OAuth consent screen verified by Google (required for external users)

### The Simple Alternative

If external people only use the add-on in **your** meetings (where you're always present), everything already works today. Your backend fetches all participants regardless of their org, because YOU are in the call. They just need the add-on installed (Option A or C above).

## Google's Fundamental Limitations

- The Meet REST API only returns meetings the authenticated user participated in
- The Meet Add-ons SDK only provides meeting ID/code — no participant list
- There is no API key, anonymous, or admin-level access to meeting participant data
- OAuth popups are blocked inside the Meet add-on iframe (it runs in a sandboxed iframe)
- There is no way to force-open an add-on for all meeting participants
- There is no API for real-time speech/audio detection — only a bot joining via headless browser could do this

## Cost Considerations

- Vercel: Free tier covers serverless functions for low usage
- Supabase: Already subscribed
- Google Workspace Marketplace: Free to list
- OAuth consent screen verification: Free but takes time
- Speech detection (future, if desired): Would need a speech-to-text API (~$0.01-0.05/min) + server for the bot

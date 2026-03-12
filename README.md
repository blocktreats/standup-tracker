# Standup Tracker — Google Meet Add-on

A Google Meet side-panel add-on that tracks who has spoken during standup and who's next. Real-time sync across all participants via Supabase.

## Features

- Participant list with join-order or shuffled speaking order
- Real-time sync across all meeting participants
- Visual progress: done / speaking / waiting / skipped
- Elapsed timer during standup
- Skip, advance, remove participants
- Dark mode support (follows system preference)

## Setup

### 1. Create the database table in Supabase

1. Open your [Supabase Dashboard](https://supabase.com/dashboard)
2. Go to **SQL Editor** and click **New query**
3. Paste the contents of `supabase-setup.sql` and click **Run**

This creates a `meetings` table and enables Realtime on it.

### 2. Get your Supabase credentials

1. In the Supabase Dashboard, go to **Project Settings > API**
2. Copy the **Project URL** (e.g., `https://abcdefgh.supabase.co`)
3. Copy the **anon / public** key

### 3. Update config.js

Open `public/config.js` and fill in your values:

```js
supabaseUrl: "https://abcdefgh.supabase.co",
supabaseAnonKey: "eyJhbGciOi...",
cloudProjectNumber: "123456789"   // from step 5 below
```

### 4. Host the static files

The `public/` folder needs to be served over HTTPS. Options:

**Vercel (easiest):**
```bash
npx vercel public/
```

**Netlify:**
Drag the `public/` folder onto [Netlify Drop](https://app.netlify.com/drop).

**Any static host:**
Upload the contents of `public/` to any HTTPS host (GitHub Pages, Cloudflare Pages, etc.).

Note the deployed URL — you'll need it next.

### 5. Set up the Google Meet Add-on

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or use an existing one)
2. Note the **Project number** (IAM & Admin > Settings) — put this in `config.js` as `cloudProjectNumber`
3. Enable these APIs (search in API Library):
   - **Google Workspace Marketplace SDK**
   - **Google Workspace Add-ons API**
4. Go to **APIs & Services > Google Workspace Marketplace SDK**
5. Click the **HTTP deployments** tab, then **Create new deployment**
6. Enter a deployment ID (e.g., `standup-tracker-v1`)
7. Paste this manifest, replacing `YOUR_HOSTING_URL`:

```json
{
  "addOns": {
    "common": {
      "name": "Standup Tracker",
      "logoUrl": "https://www.gstatic.com/images/branding/product/2x/meet_2020q4_48dp.png"
    },
    "meet": {
      "web": {
        "sidePanelUrl": "YOUR_HOSTING_URL/sidepanel.html",
        "addOnOrigins": ["YOUR_HOSTING_URL"]
      }
    }
  }
}
```

8. Click **Install** under Actions to install for your account

### 6. Test it

1. Open [Google Meet](https://meet.google.com/) and start or join a meeting
2. Click the **Activities** button (puzzle piece icon)
3. Find **Standup Tracker** under "Your add-ons"
4. Enter your name and start tracking!

## How it works

1. Each participant opens the add-on from the Activities panel
2. They enter their name (saved locally for next time)
3. The lobby shows everyone who has joined
4. Click **Shuffle & Start** or **Start in Order** to begin
5. Current speaker is highlighted — click **Done > Next** to advance
6. Timer shows total elapsed time
7. Click **New Standup** to reset when done

All state syncs in real-time — every participant sees the same thing.

## Local development

Serve the `public/` folder locally:

```bash
npx serve public/
```

Open `http://localhost:3000/sidepanel.html`. The Meet SDK won't load outside of Meet, so it falls back to a shared test meeting ID — useful for testing the Supabase sync and UI across multiple browser tabs.

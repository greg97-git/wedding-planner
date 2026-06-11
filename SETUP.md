# Wedding Planner — Setup Guide
## Greg & Sofia · August 14, 2026

This guide takes you from zero to a live, password-protected app that you and
Sofia can both use from any device. Estimated time: ~30 minutes.

---

## Part 1 — Supabase (database + real-time sync)

### 1.1 Create your Supabase project

1. Go to https://supabase.com and sign up for a free account
2. Click **New Project**
3. Fill in:
   - **Name:** `wedding-planner` (or anything you like)
   - **Database password:** choose something strong and save it somewhere safe
   - **Region:** pick the one closest to you (Canada East or US East)
4. Click **Create new project** — takes about 60 seconds to provision

### 1.2 Create the database table

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Paste and run this SQL:

```sql
-- Create the table that stores all wedding app data
CREATE TABLE wedding_data (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow the app to read and write (anon key is safe since the app has its own password)
ALTER TABLE wedding_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON wedding_data
  FOR ALL USING (true) WITH CHECK (true);

-- Enable real-time updates so both devices sync instantly
ALTER PUBLICATION supabase_realtime ADD TABLE wedding_data;
```

4. Click **Run** — you should see "Success. No rows returned."

### 1.3 Get your API credentials

1. In the left sidebar, go to **Project Settings** → **API**
2. Copy these two values — you'll need them shortly:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

---

## Part 2 — GitHub repo

### 2.1 Create the repository

1. Go to https://github.com and sign in to your account
2. Click **+** → **New repository**
3. Fill in:
   - **Repository name:** `wedding-planner`
   - **Visibility:** Private (recommended — keeps your guest data off public internet)
   - Leave everything else as default
4. Click **Create repository**

### 2.2 Push the code

In your terminal, from inside the `wedding-app` folder:

```bash
# Initialise git
git init
git add .
git commit -m "Initial wedding planner app"

# Connect to your GitHub repo (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/wedding-planner.git
git branch -M main
git push -u origin main
```

---

## Part 3 — Add secrets to GitHub

This is how your app gets the Supabase credentials and password without
putting them in the code (which would be visible on GitHub).

1. In your GitHub repo, go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add each of these three secrets:

| Secret name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase Project URL from step 1.3 |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key from step 1.3 |
| `VITE_APP_PASSWORD` | The shared password you and Sofia will use |

---

## Part 4 — Enable GitHub Pages

1. In your GitHub repo, go to **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Click **Save**

---

## Part 5 — Deploy

1. In your GitHub repo, go to the **Actions** tab
2. You should see a workflow called **Deploy to GitHub Pages** that ran when
   you pushed the code
3. Click it — if it's green ✓ you're live
4. If it hasn't run yet, go to **Actions** → **Deploy to GitHub Pages** →
   **Run workflow**

Your app will be live at:
```
https://YOUR_USERNAME.github.io/wedding-planner/
```

> **Note:** If your repo name is different from `wedding-planner`, update
> the `base` field in `vite.config.js` to match. For example, if the repo
> is `greg-sofia-wedding`, change it to `base: '/greg-sofia-wedding/'`.

---

## Part 6 — Import your existing data

1. Open the app at your GitHub Pages URL
2. Enter your password — you'll see the first-launch screen
3. Click **Load existing data (import JSON)**
4. Select the `wedding-planner-export-YYYY-MM-DD.json` file you downloaded
   from the Claude artifact
5. Your guests, tables, rooms, vendors, and todos will all load in
6. From this point on, data is stored in Supabase and shared between devices

---

## Sharing with Sofia

Just send her the URL and the password. That's it. Any change either of
you makes will appear on the other's screen within a second or two.

---

## Updating the app later

Whenever you want to make changes to the app:

1. Come back to this Claude conversation
2. Ask for the change — I'll update `wedding-planner.jsx`
3. Copy the updated file into your local `src/App.jsx`
4. Run `git add . && git commit -m "your change" && git push`
5. GitHub Actions redeploys automatically — live in ~60 seconds

---

## Troubleshooting

**"Missing Supabase environment variables" error on deploy**
→ Double-check the three secrets in GitHub → Settings → Secrets. Names must
match exactly (case-sensitive).

**App loads but data doesn't save**
→ Check the Supabase SQL editor — make sure the `wedding_data` table exists
and the RLS policy was created successfully.

**Changes on one device don't appear on the other**
→ Make sure you ran the `ALTER PUBLICATION` line in the SQL. Check the
Supabase dashboard → Database → Replication to confirm `wedding_data`
is listed.

**GitHub Pages shows a blank page**
→ The `base` in `vite.config.js` must exactly match your repo name.

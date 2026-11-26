# Turning on accounts and AI buck identification

The app works without this setup: everything is saved on your phone only. These steps add:

- **Personal logins** (Part 1, **free**), so your places, stands, cameras, and bucks sync across devices.
- **AI photo identification** (Part 2, an **optional paid upgrade**), where Claude suggests which buck is in each trail-cam photo. Skip it to keep the app 100% free. You can tag bucks yourself, and pattern learning and target-buck recommendations work the same.

| Plan | Cost | What you get |
|---|---|---|
| Free | $0 | Everything except AI photo reading. You pick the buck in each photo. |
| Basic AI | ≈ $1–2 per 1,000 photos | A smaller Claude model (Haiku) sorts photos (buck, doe, empty) and reads the date and time stamp. It is less reliable at telling similar bucks apart. |
| Pro AI | ≈ 3–8¢ per photo | Claude Opus compares antlers against your known bucks, flags new bucks, and reads the stamp. |

Both AI plans also unlock **Ask the coach** during a hunt: well under a penny per question on Basic, and a few cents on Pro.

Choose the plan in the app under **Account → Upgrade: AI photo identification**. AI costs are billed by Anthropic to your own API account, with a spending limit you set.

**Free-plan limits worth knowing**
- Supabase's free plan stores about 1 GB of photos, roughly 6,000 trail-cam photos at the size the app saves.
- A free Supabase project **pauses after about a week with no use**. If that happens, sign in at supabase.com and click **Restore project**; nothing is lost.
- The weather data (Open-Meteo) is free for personal, non-commercial use.

Supabase's screens change from time to time, so a button name may differ slightly from what's written here.

---

## Part 1: Supabase (logins and database), about 10 minutes

1. Go to **https://supabase.com** and click **Start your project**. Sign up; using your GitHub account is easiest.
2. Click **New project**.
   - Name: `hunting-app`
   - Database password: click **Generate a password** and save it somewhere safe. You won't need it day to day.
   - Region: pick the one closest to you.
   - Click **Create new project** and wait a minute or two while it sets up.
3. **Create the database tables.** In the left menu, open **SQL Editor** and click **New query**.
   Open [`supabase/schema.sql`](supabase/schema.sql) in this repository on GitHub and click the **Copy raw file** button.
   Paste it into the editor and click **Run**. You should see "Success. No rows returned".
4. **Tell Supabase where the app lives.** In the left menu, open **Authentication → URL Configuration**.
   - Site URL: `https://jfulton517.github.io/Hunting-App/`
   - Under **Redirect URLs**, add the same address.
   - Click **Save**.
5. **Get the two connection values.** Open **Project Settings** (the gear icon), then **API** (it may be called **Data API**, or the keys may be under **API Keys**). Copy:
   - **Project URL**, which looks like `https://abcdefgh.supabase.co`
   - **anon public** key, or **publishable** key: a long string
6. Send both values to Claude in the chat. **They are safe to share.** They're designed to be public, and your data is protected by the security rules from step 3. Claude puts them in `src/config.ts`, and accounts switch on the next time the site publishes.

> Never share the **service_role** or **secret** key, or your database password. The app doesn't need them.

## Part 2 (optional upgrade): AI buck identification, about 10 minutes

Only needed for the Basic AI or Pro AI plan. Each photo is one request to Claude, at the costs in the table above. You only pay for what you use, and you can set a monthly spending limit in the Anthropic Console.

1. Go to **https://console.anthropic.com** and sign up.
2. Open **Billing** and add a payment method or credits. Set a monthly **spend limit**, for example $10.
3. Open **API Keys**, then **Create Key**, and name it `hunting-app`. **Copy the key right away**; it's shown once.
   - **Do not paste this key into the chat or the code.** It goes only into Supabase, in step 5.
4. In Supabase, open **Edge Functions** in the left menu, then **Deploy a new function** and choose **Via Editor**.
   - Name it exactly `identify-deer`.
   - Delete the sample code, then paste the contents of [`supabase/functions/identify-deer/index.ts`](supabase/functions/identify-deer/index.ts). Use the **Copy raw file** button on GitHub.
   - Click **Deploy function**.
   - Repeat for the **AI hunting coach**: deploy a second function named exactly `hunt-coach` with the contents of [`supabase/functions/hunt-coach/index.ts`](supabase/functions/hunt-coach/index.ts).
5. In Supabase, go to **Edge Functions → Secrets** (or **Project Settings → Edge Functions**) and add a secret:
   - Name: `ANTHROPIC_API_KEY`
   - Value: the key from step 3
   - Save.

6. In the app, open **Account → Upgrade: AI photo identification**, choose **Basic AI** or **Pro AI**, and tap **Test AI setup**. You should see "✓ AI is set up and ready."

That's it. Photos you add on the **Trail Cam** tab now get an AI suggestion that you confirm or correct. Switch back to **Free** at any time.

---

## Getting photos from Strike Force Wireless

Browning doesn't offer a way for other apps to sign in to Strike Force Wireless, so photos come in through a download:

**On a computer (best for lots of photos)**
1. Sign in at **strikeforcewireless.com** and open **Photos**.
2. Filter to one camera, click **Select All** (top right), and download.
3. In Hunt Forecast, go to **Trail Cam**, pick that camera, then drag the downloaded photos, folder, or **ZIP file** onto the Add Photos box. You can also use **Choose photos or ZIP** or **Choose a whole folder**.

**On your phone**
1. In the **Strike Force Wireless** app, tap **Select All**, then **Share → Save Images**.
2. In Hunt Forecast, go to **Trail Cam**, pick the camera, tap **Choose photos or ZIP**, and select the saved photos.

**What happens to each photo (free)**
- **Date and time:** taken from the photo file when it's there. If not, the app **reads the date/time stamp printed on the photo**, right on your phone with free text recognition. The first use downloads the reader (about 3 MB).
- **Weather:** the app looks up the **temperature, wind, barometric pressure trend, temperature change from the day before, and moon phase** at the exact hour each photo was taken, using historical weather for the camera's location. Give each camera a location in Account → Trail cameras.
- Photos imported before this update, or while you were offline: tap **Analyze photos** on the Trail Cam tab to do both steps for all of them at once.
- **Quick tag** buttons (Buck, Doe, Fawn, Empty) confirm a photo with one tap.
- On the **Photo log**, tap a camera's name to see **when bucks move on that camera** and the **best upcoming times to hunt it**.

**Good to know**
- **Duplicates are skipped automatically**, so you can re-download everything each time without double-counting sightings.
- **Free plan:** you pick the buck in each photo. With the **AI upgrade**, the AI suggests the buck and reads the date and time from each photo's info strip. Before a large batch is sent to the AI, the app shows the estimated cost and lets you import without AI instead.
- After about 3 confirmed sightings, a buck's page starts showing **his pattern** and **the best upcoming times and stands** to hunt him. Mark your **target** with the ★ button.

> **Already ran `supabase/schema.sql` before this update?** Run it once more (SQL Editor → paste → Run). It's safe to re-run, and it adds the column used to skip duplicate photos.

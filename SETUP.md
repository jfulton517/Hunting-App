# Turning on accounts and AI buck identification

The app works without this setup: everything is saved on your phone only. These steps add:

- **Personal logins**, so your places, stands, cameras, and bucks sync across devices (Supabase, free).
- **AI photo identification**, where Claude suggests which buck is in each trail-cam photo (Anthropic API, pay per photo).

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

## Part 2: AI buck identification, about 10 minutes

**Cost:** each photo is one request to Claude Opus 5.5 at a low thinking-effort setting. That's roughly **3–6¢ per photo**, depending on how many reference photos of your known bucks are included. You only pay for what you use, and you can set a monthly spending limit in the Anthropic Console.

1. Go to **https://console.anthropic.com** and sign up.
2. Open **Billing** and add a payment method or credits. Set a monthly **spend limit**, for example $10.
3. Open **API Keys**, then **Create Key**, and name it `hunting-app`. **Copy the key right away**; it's shown once.
   - **Do not paste this key into the chat or the code.** It goes only into Supabase, in step 5.
4. In Supabase, open **Edge Functions** in the left menu, then **Deploy a new function** and choose **Via Editor**.
   - Name it exactly `identify-deer`.
   - Delete the sample code, then paste the contents of [`supabase/functions/identify-deer/index.ts`](supabase/functions/identify-deer/index.ts). Use the **Copy raw file** button on GitHub.
   - Click **Deploy function**.
5. In Supabase, go to **Edge Functions → Secrets** (or **Project Settings → Edge Functions**) and add a secret:
   - Name: `ANTHROPIC_API_KEY`
   - Value: the key from step 3
   - Save.

That's it. Sign in to the app, add a camera, and add photos on the **Trail Cam** tab. Each photo gets an AI suggestion that you confirm or correct.

---

## Getting photos from Strike Force Wireless

Browning doesn't offer a way for other apps to connect to Strike Force Wireless, so photos come in through your phone's photo library:

1. In **Strike Force Wireless**, open a photo, tap **Share**, then **Save Image**. You can also select several photos and save them together.
2. In Hunt Forecast, go to **Trail Cam**, choose the camera, then **Choose photos** and pick the saved photos.
3. Review each photo. The AI reads the date, time, and temperature from the info strip along the bottom of each Browning photo, and suggests a buck. Confirm it or correct it.

After about 3 confirmed sightings, a buck's page starts showing **his pattern** and **the best upcoming times and stands** to hunt him. Mark a buck as your **target** with the ★ button.

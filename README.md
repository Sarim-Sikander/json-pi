# Json-Pi — Complete Deployment Guide

A single-page web app for parsing, converting, validating, and analyzing JSON/YAML/CSV data, with a public REST API backed by Netlify Functions and a contact form backed by Supabase.

---

## Folder structure

```
.
├── netlify.toml              # Netlify build config
├── package.json              # JS dependencies for Netlify Functions
├── supabase-setup.sql        # SQL to create the contacts table in Supabase
├── README.md                 # This file
├── public/
│   └── index.html            # The Json-Pi app (single static file)
└── netlify/
    └── functions/
        ├── _lib.js           # Shared helpers (parse, autofix, types, etc.)
        ├── parse.js          # POST /api/parse
        ├── convert.js        # POST /api/convert
        ├── explain.js        # POST /api/explain
        ├── query.js          # POST /api/query
        ├── types.js          # POST /api/types
        ├── schema.js         # POST /api/schema
        ├── validate.js       # POST /api/validate
        ├── mock.js           # POST /api/mock
        ├── diff.js           # POST /api/diff
        ├── contact.js        # POST /api/contact      (saves to Supabase)
        └── contact-history.js # GET /api/contact-history (admin-gated)
```

---

## Setup — step by step

### Part 1: Supabase setup (~5 minutes)

1. Go to https://supabase.com and sign up (free)
2. Click **New project**. Pick any name (e.g., `json-pi`), pick a region close to your users, set a strong database password (you won't need to remember it)
3. Wait ~1 minute for the project to provision
4. In the project dashboard, click **SQL Editor** in the left sidebar
5. Click **New query**
6. Open `supabase-setup.sql` (in this folder) and paste its entire contents into the SQL editor
7. Click **Run** (Cmd/Ctrl + Enter)
8. You should see "Success. No rows returned."
9. Get your credentials:
   - Click the **Settings** gear icon in the sidebar
   - Click **API**
   - Copy the **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - Copy the **service_role secret key** (under "Project API keys"). ⚠️ This is a powerful key — never paste it in your HTML, never commit it to Git, only put it in Netlify environment variables.

### Part 2: Pick an admin token

This is the password you'll enter in the Contact History tab to view submissions. Pick something long and random — at least 32 characters. Generate one with:

```bash
openssl rand -hex 24
# or
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Save this token somewhere safe (a password manager). You'll need it in Netlify's env vars AND when accessing the Contact History tab.

### Part 2b: Resend setup for email replies (~5 minutes)

The "Reply" button in the Contact History tab uses Resend to send emails. Skip this section if you don't need to reply to users from inside the app.

1. Go to https://resend.com and sign up (free)
2. Add your domain: **Domains** → **Add Domain** → `json-pi.com`
3. Resend gives you 3 DNS records (SPF, DKIM, DMARC). Add them at your DNS provider (Cloudflare/registrar). Most providers have a one-click "Auto configure" if your domain is on Cloudflare.
4. Wait for status to change to **Verified** (usually 1-5 minutes)
5. Go to **API Keys** → **Create API Key** → name it `json-pi-production`, permission `Sending access`
6. Copy the key (starts with `re_...`). You'll add it to Netlify in Part 4.

### Part 2c: Add the replies table to Supabase

Run `supabase-add-replies-table.sql` in the Supabase SQL Editor (same as Part 1, step 6). This creates a `replies` table to track sent emails.

### Part 3: Push to GitHub

1. Create a new Git repository (private if you prefer; Netlify can deploy either way)
2. Initialize and push:

```bash
cd path/to/this/folder
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/json-pi.git
git push -u origin main
```

3. (Optional but recommended) Add a `.gitignore`:

```
node_modules/
.netlify/
.env
.DS_Store
```

### Part 4: Connect to Netlify

1. Go to https://app.netlify.com and sign up (free)
2. Click **Add new site** → **Import an existing project**
3. Pick GitHub (or your Git provider) and authorize
4. Pick your `json-pi` repository
5. Netlify will auto-detect settings from `netlify.toml`. Confirm:
   - Build command: (leave empty)
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
6. **Do not deploy yet.** Click **Show advanced** → **New variable** to add environment variables:

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | `https://xxxxxxxxxxxx.supabase.co` (from Part 1) |
   | `SUPABASE_SERVICE_KEY` | the service_role key (from Part 1) |
   | `ADMIN_TOKEN` | the token you generated (from Part 2) |
   | `RESEND_API_KEY` | the Resend API key (from Part 2b, only if using email replies) |

7. Click **Deploy site**
8. Wait 30-60 seconds for the first build. You'll get a URL like `https://random-name-12345.netlify.app`
9. (Optional) Change to a custom subdomain: Site settings → Domain management → Options → Edit site name → pick `json-pi` or whatever you want.

### Part 5: Update the API URL in the app

The Developer Docs tab shows code snippets with a placeholder base URL (`https://api.json-pi.app/v1`). Update it to your actual Netlify URL:

1. Open `public/index.html`
2. Find this line (search for `DEV_DOCS_BASE_URL`):
   ```js
   const DEV_DOCS_BASE_URL = 'https://api.json-pi.app/v1';
   ```
3. Change it to your Netlify URL with `/api`:
   ```js
   const DEV_DOCS_BASE_URL = 'https://YOUR-SITE-NAME.netlify.app/api';
   ```
4. Commit and push — Netlify auto-redeploys.

---

## Verification — does it work?

After deployment, test each piece:

### 1. The app loads
Visit `https://YOUR-SITE-NAME.netlify.app` — you should see Json-Pi.

### 2. The API works
```bash
curl -X POST https://YOUR-SITE-NAME.netlify.app/api/parse \
  -H "Content-Type: application/json" \
  -d '{"text":"{name: \"Acme\"}","auto_fix":true}'
```
Should return JSON with `"ok":true`.

### 3. The contact form works
1. Open the app
2. Click "Contact" in the footer
3. Fill in subject + message, click Send
4. Should see "✓ Thank you — your message has been sent."

### 4. The contact history works
1. Click the ⚙ button (bottom-right)
2. Enter developer code: `sarim-26`
3. After unlock, a new "📬 Contact History" tab appears
4. Click it, enter your admin token
5. You should see the submission from step 3

### 5. Verify in Supabase (optional)
In the Supabase dashboard, go to **Table Editor** → `contacts`. You should see your test submission.

---

## API endpoints

All POST (except `contact-history` which is GET), all return JSON, all support CORS:

| Endpoint | Purpose | Auth |
|---|---|---|
| `POST /api/parse`            | Parse JSON/YAML with auto-fix | none |
| `POST /api/convert`          | Convert between JSON and YAML | none |
| `POST /api/explain`          | Structural breakdown | none |
| `POST /api/query`            | JSONPath query | none |
| `POST /api/types`            | Infer field types | none |
| `POST /api/schema`           | Generate JSON Schema from data | none |
| `POST /api/validate`         | Validate data against schema | none |
| `POST /api/mock`             | Generate mock records (1-1000) | none |
| `POST /api/diff`             | Compare two documents | none |
| `POST /api/contact`          | Submit contact form | none |
| `GET  /api/contact-history`  | Fetch all contacts | `X-Admin-Token` header |
| `POST /api/contact-reply`    | Send an email reply to a contact | `X-Admin-Token` header |

Full code examples for each endpoint in the Developers tab of the live site.

---

## Security model

| Layer | What protects it | Threat |
|---|---|---|
| Developer code (`sarim-26`) | SHA-256 hash in HTML, checked client-side | Anyone with DevTools can read/brute-force. Treat as convenience gate only. |
| Admin token | Random secret in Netlify env vars, checked server-side | A real password. Anyone who can read Netlify's env vars can read submissions. Don't share your Netlify password. |
| Supabase service_role key | In Netlify env vars only, never sent to browser | If leaked → full database access. Treat like a production database password. |
| Anon/public access to Supabase | Disabled via Row-Level Security | Even if the project URL leaks, no one can read or insert without a key. |

**Bottom line:** the developer code unlocks the *UI*, the admin token unlocks the *data*. They are separate by design.

---

## Local testing (optional)

To run the site locally with working Functions:

```bash
npm install -g netlify-cli   # one-time
cd /path/to/this/folder
npm install                  # installs js-yaml
netlify dev                  # starts local dev server
```

Open http://localhost:8888. The Functions will use your local `.env` file if present:

```env
# Create a .env file in the project root (do NOT commit):
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
ADMIN_TOKEN=your_admin_token
```

---

## Costs

| Service | Free tier covers | When you'd hit limits |
|---|---|---|
| **Netlify** | 100 GB bandwidth/month, 125,000 function invocations/month | Heavy daily use; for casual use it's free forever |
| **Supabase** | 500 MB database, 2 GB bandwidth, paused after 1 week idle | 1000 contact submissions ≈ 1 MB. Unlikely to hit limits. |

For a personal project or low-traffic tool, expect to pay **$0** indefinitely.

---

## What to change before going live

- [ ] `DEV_DOCS_BASE_URL` in `public/index.html` (Part 5 above)
- [ ] Optional: Change developer code (`sarim-26`) by computing a new SHA-256 hash and updating `DEV_CODE_HASH` constant in the HTML. To compute a new hash:
  ```bash
  node -e "console.log(require('crypto').createHash('sha256').update('YOUR-NEW-CODE').digest('hex'))"
  ```
- [ ] Optional: Set up a custom domain in Netlify
- [ ] Optional: Set up custom email forwarding (e.g., via Cloudflare Email Routing) so you can use a public address like contact@json-pi.app instead of relying on the form only

---

## Contact

Built by **Sarim Sikander** · Direct: sarimsikander24@gmail.com

For app-related issues, use the in-app Contact form. It's why we built it.

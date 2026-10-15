# Eswatini Health Project Visualisation

A password-protected website that maps where TB patients in Eswatini live and
where they died, with charts that break patients and deaths down by region,
age group, sex, HIV status, TB type and constituency.

**For internal use by the organisation only.**

## What it does

- **Map**: one circle per place, sized by number of patients and coloured by
  deaths (none / 1 / 2 or more). Click a circle for the details.
- **Charts**: each group (region, age, sex, HIV, TB type, constituency) shows
  alive vs died and the death rate. Click a bar to filter the whole page by it.
- **Filters**: region, TB type, HIV status, sex, age group and constituency.
  Active filters show as chips you can remove one by one.
- **Copy link to this view**: the address keeps the current filters and tab,
  so you can send a colleague the exact view. They still need the password.
- **Download summary (CSV)**: counts per constituency for the current
  filters. It never contains patient-level rows.
- **Add boundaries (GeoJSON)**: overlay district or constituency outlines
  from a local file.

## How the data is protected

The patient rows are stored only in encrypted form (`assets/tb-data.enc.js`,
AES-256-GCM with a key derived from the password by PBKDF2-SHA256, 250,000
iterations). The browser decrypts them after the password is typed; nothing
is sent to a server. The page asks search engines not to index it.

Because the encrypted file is publicly downloadable, **the password is the
only protection**. Use a long one (a phrase of 4 or more random words, or 16+
characters), share it only with people who need it, and change it (re-encrypt,
below) if it leaks or someone leaves.

## Put it online (Vercel)

1. Sign in at **https://vercel.com** with your GitHub account.
2. Click **Add New… → Project**, find **Eswatini-Health-Project-Visualisation**
   and click **Import** (if it is not listed, click **Adjust GitHub App
   Permissions** and give Vercel access to this repository).
3. Leave **Framework Preset** as **Other**, leave the build and output
   settings empty, and click **Deploy**.
4. When it finishes, Vercel shows the address (for example
   `https://eswatini-health-project-visualisation.vercel.app`).

Every push to `main` redeploys the site automatically. `vercel.json` adds
security headers (Content-Security-Policy, no framing, `noindex`), and
`.vercelignore` keeps `tools/` and the README off the site.

## Or put it online with GitHub Pages

1. In this repository on GitHub go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**,
   pick **main** and **/ (root)**, and click **Save**.
3. After a minute or two the site is live at
   **https://welshamar.github.io/Eswatini-Health-Project-Visualisation/**

Every push to `main` updates the live site automatically. The old address
`tb_web_map.html` forwards to the new page.

## Update the data or change the password

You need the patient rows as a JSON array (one row per patient, the field
order is described at the top of `tools/encrypt_data.py`). Keep that file
**out of this repository**.

```bash
pip install cryptography
python tools/encrypt_data.py path/to/rows.json      # asks for the new password twice
git add assets/tb-data.enc.js && git commit -m "Update TB data" && git push
```

## Run it on your computer

The unlock step needs a secure page (https or localhost), so open it through a
small local web server rather than double-clicking the file:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Files

```
index.html             the page
assets/app.js          map, charts, filters, downloads
assets/app.css         styles (light and dark)
assets/tb-data.enc.js  the encrypted patient data
assets/leaflet/        Leaflet 1.9.4 map library (served locally, no CDN)
tools/encrypt_data.py  encrypts new data / sets a new password
tb_web_map.html        forwards old links to index.html
vercel.json            Vercel hosting settings and security headers
```

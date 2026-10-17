# BookScan

Mobile-first installable web app (PWA): scan a book's barcode → look up ISBN (Open Library + Google Books) → save to a local database → export CSV.

**Run:** the camera needs HTTPS. Easiest: host `index.html` on GitHub Pages / Netlify and open it on your phone. For local testing, `python3 -m http.server` and open `http://localhost:8000` (localhost counts as secure).

**Fields:** title, author, original publication year (Open Library first-publish year, falls back to edition date), main category, sub category (from Google Books categories), tags (`;`-separated: categories + Open Library subjects), Amazon link (`amazon.co.uk/dp/<ISBN-10>`; falls back to an ISBN search for 979- books). Change `AMAZON_DOMAIN` in the script for another store.

**Storage:** IndexedDB in the browser; cells are editable; Export CSV to back up or open in Excel/Sheets.

**Install:** open the URL on your phone → Share / ⋮ menu → *Add to Home Screen*. It then runs full-screen and loads offline (lookups still need a connection).

**Use:** tap *Scan books* and keep scanning one after another; tap a book to edit or delete; *Export* shares a CSV via the phone's share sheet.

## Google Sheets backup

1. Create a Google Sheet. Extensions → Apps Script → paste `apps-script/Code.gs`, replace `KEY` with a long random string, save.
2. Deploy → New deployment → type **Web app** → Execute as **Me**, access **Anyone** → Deploy, authorise, copy the `/exec` URL.
3. In the app tap ☁︎, paste the URL and the same key, tap **Sync now**.

Changes upload automatically (and queue while offline). *Sync now* also pulls the sheet down, so a second device sees the same books. The sheet wins for books it already holds; rows deleted in the sheet are not removed from the phone.

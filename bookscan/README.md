# BookScan

Single-file web app: scan a book's barcode → look up ISBN (Open Library + Google Books) → save to a local database → export CSV.

**Run:** the camera needs HTTPS. Easiest: host `index.html` on GitHub Pages / Netlify and open it on your phone. For local testing, `python3 -m http.server` and open `http://localhost:8000` (localhost counts as secure).

**Fields:** title, author, original publication year (Open Library first-publish year, falls back to edition date), main category, sub category (from Google Books categories), tags (`;`-separated: categories + Open Library subjects), Amazon link (`amazon.co.uk/dp/<ISBN-10>`; falls back to an ISBN search for 979- books). Change `AMAZON_DOMAIN` in the script for another store.

**Storage:** IndexedDB in the browser; cells are editable; Export CSV to back up or open in Excel/Sheets.

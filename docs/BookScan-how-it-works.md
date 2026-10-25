# BookScan: how it works, and what we learned about getting accurate book data

*Written for someone planning a school library app. It describes a working personal prototype ("BookScan"), the data sources it uses, what went wrong along the way, and what we would do differently for a school.*

**How reliable is this document?** The prototype was built and tested over several sessions with a real phone, a real Google Sheet and a real library of about 15 books. Findings marked **[confirmed]** were observed on the real phone or in real data pasted from the sources. Findings marked **[tested with mocks]** passed automated tests against simulated responses only. Findings marked **[assumed]** come from general knowledge and have not been checked here. Section 13 lists every unverified claim in one place.

---

## 1. The short version

- A phone web app scans a book's barcode, reads the ISBN, looks it up in free public book databases, and saves the result.
- No single free source is complete or reliable. Accuracy came from **combining several sources, validating inputs, never silently guessing, and recording where each value came from.**
- The hardest problems were not "find the title". They were: **categories and subjects** (the thing a library cares most about), **niche and very new books**, **rate limits**, and **barcodes that scan badly**.
- An AI step (Claude) fills the gaps the databases leave, but only into empty fields, with a confidence rating and a provenance note, so a human can see and correct it.
- For a school: the technology transfers well, but **student data, shared access, multiple copies of the same title, and existing library standards** change the design a great deal (section 12).

### The ten lessons that mattered most

1. **Validate the ISBN before doing anything** (check digit, 978/979 prefix). Cheap and it stops garbage reaching your lookups.
2. **Use several sources and merge field by field.** Each source was strong on some fields and empty or wrong on others.
3. **Treat "the lookup failed" and "the book isn't there" as different outcomes.** Early on, a rate-limit error was being saved as a blank book. Never conflate them.
4. **Never overwrite good data with a guess.** Fill only empty fields, and record the source of every inferred value.
5. **Open Library's classification numbers are merged across every edition of a work.** Taking the first one gave "Computer science" for *Harry Potter*. Take the most common class instead.
6. **Library classification (Dewey or Library of Congress) is a better category source than retail or "subject" tags** for academic stock, and it works when Google Books is unavailable.
7. **Crossref lists every chapter under the book's ISBN.** Pick the book-level record, not the first result.
8. **Free APIs ration you in ways that are invisible until they fail.** Google Books anonymous access had an allowance of zero for us. Plan for rate limits from day one.
9. **Barcode decoding quality varies enormously by library.** The common JavaScript decoder failed on a clean, large barcode against a dark background. A WebAssembly build of ZXing fixed it.
10. **Installed web apps cache aggressively.** We lost days to a phone running an old copy of the code. Design the update path early.

---

## 2. What the app does (user's view)

1. Open the app on a phone (it is a web page that installs like an app).
2. Tap **Scan books**, point the camera at the barcode, keep going book after book. A "Take a photo instead" button handles barcodes the live camera cannot read.
3. Each scan looks up the book, saves it, and (in the background) asks an AI to fill any missing category, tags, key concepts and description.
4. The list shows each book as a card: title, author, year, category, concepts (green) and tags (grey).
5. Tapping an author, category, concept or tag shows every book that shares it. Opening a book shows **related books**, ranked by what they share.
6. Every change is backed up to a Google Sheet, which is the permanent record.
7. A **Fill in incomplete books** button re-runs lookups and AI over any rows with gaps.

**Fields stored per book:** ISBN-13 (the key), title, author, original publication year, main category, sub category, tags, key concepts, description, catalogue link, Amazon link, Open Library work ID, author ID (Wikidata and Open Library), a *Source* note, and the date added.

---

## 3. Architecture

```
                    ┌──────────────────────────────────────────┐
   Phone (browser)  │  Static web page (GitHub Pages, HTTPS)   │
                    │  - camera + barcode decoding (WASM)      │
                    │  - lookups to public APIs (CORS)         │
                    │  - local database (IndexedDB)            │
                    │  - offline queue of changes              │
                    └───────────┬──────────────────┬───────────┘
                                │ lookups          │ sync + AI requests
                                ▼                  ▼
              Open Library, Crossref,     Google Apps Script "web app"
              Google Books (free APIs)    - reads/writes the Google Sheet
                                          - calls the Claude API
                                          - holds the secret keys
                                                   │
                                                   ▼
                                            Google Sheet ("Books" tab)
```

**Design choices and why**

| Choice | Reason | Cost of the choice |
|---|---|---|
| A web app (PWA), not a native app | No app store, works on any phone, free hosting, camera works over HTTPS | Camera and storage behaviour differs between iPhone and Android; no background work |
| Hosting on GitHub Pages | Free HTTPS static hosting | Free plan needs a **public** repository (the code is public; the data is not in it) |
| Local database in the phone (IndexedDB) | Works offline; fast | Data lives in one browser; clearing site data deletes it, hence the sheet backup |
| Google Sheet as the master record | Free, familiar, human-readable, filterable, shareable | A spreadsheet is not a real database; see section 12 |
| Apps Script as a tiny server | Free; lets a secret (the AI key) live off the phone; no CORS issues calling other APIs | One shared secret as "security"; slow cold starts; hard limits on runtime and quotas |
| Lookups made directly from the phone | No server needed | Each user's phone is the one rate-limited by the APIs |

**Offline behaviour.** Every save is added to a queue stored on the phone and sent to the sheet when a connection is available. The sheet wins on conflicts for books it already holds. Deleting a row in the sheet does not remove it from the phone (a known gap).

---

## 4. Barcode scanning

### What we use

- **Library:** `zxing-wasm` (the C++ ZXing reader compiled to WebAssembly), self-hosted next to the app.
- **Camera:** requested at up to 1920 x 1080 with the rear camera. We decode the middle half of each frame, about every 100 ms, accepting only `EAN-13` codes beginning `978` or `979` that pass the ISBN check digit.
- **De-duplication:** the same code is ignored for 6 seconds after it is read, so one book does not add twice.
- **Fallback:** a button takes a photo with the phone's own camera app (which focuses far better than a web video stream) and decodes the photo.

### What went wrong first (and the evidence)

| Problem | Evidence | Fix |
|---|---|---|
| First decoder (`html5-qrcode`, a JavaScript ZXing port) could not read many book barcodes | **[confirmed]** On the real phone it reported nothing for a Canongate paperback. In our own tests it failed on a large, clean EAN-13 whenever the barcode sat on a **dark** background, which is exactly what a dark book cover looks like | Replaced with `zxing-wasm`, which decoded the same test images |
| Camera asked for no resolution | **[confirmed by reasoning, partly by test]** Browsers default to roughly 640 x 480 for `getUserMedia`; a book barcode then has too few pixels. Our synthetic tests showed a 480 px-wide frame failing where a 1080 px-wide frame succeeded | Ask for 1080p |
| One particular book would not scan live | **[confirmed]** Glossy, curved label | Photo fallback, or type the ISBN. Accept that some labels will always need the manual route |

### Practical advice

- Hold the book 15 to 25 cm away and keep it steady. Closer is not better: phones cannot focus very close up.
- Provide **manual ISBN entry** and **photo scanning** from the start, not as an afterthought.
- Test on a real phone with real books of different colours and finishes. Simulated barcodes were useful for catching bugs but could not predict how glossy labels behave.

---

## 5. Looking up the book

### 5.1 Clean and validate the ISBN first

```text
1. Strip everything except digits and X.
2. Accept it only if it is a valid ISBN-13 (check digit mod 10) or ISBN-10 (check digit mod 11).
3. Convert ISBN-10 to ISBN-13 (prefix 978, recompute check digit). ISBN-13 is the database key.
4. Barcodes that are not ISBNs (price add-ons, other EANs) are ignored.
```

### 5.2 The sources, what each is good for, and how reliable it was

| Source | Used for | Notes from real use |
|---|---|---|
| **Open Library search** (`/search.json?q=isbn:...`) | Title, authors, **first publication year**, subjects, **Dewey (`ddc`)**, **Library of Congress class (`lcc`)**, the **work key** and **author key** | The most useful single source. Free, no key. Coverage is good for mainstream books and patchy for new or academic ones. The `first_publish_year` is the "original publication" a catalogue wants, rather than the edition date |
| **Open Library edition data** (`/api/books?bibkeys=ISBN:...&jscmd=data`) | Fallback title, authors, subjects, classification for the exact edition | Catches some books the search index misses |
| **Open Library work and author records** (`/works/OL...W.json`, `/authors/OL...A.json`) | Description; link from the author to **Wikidata** (`remote_ids.wikidata`) | Optional extras; failures are ignored. The Wikidata link is **[tested with mocks]** only |
| **Crossref** (`api.crossref.org/works?filter=isbn:...`) | Title and authors for university-press and scholarly books | Useful, with a trap: see 5.4 |
| **Google Books** (`/volumes?q=isbn:...`) | Categories, edition title and authors | **Rationed, then unreliable for us**: see 5.5 |
| **Title and author search** (Open Library and Google Books) | Manual fallback when an ISBN is unknown | Lets a person pick the right book and keep the scanned ISBN |

### 5.3 The merge

All sources are queried in parallel. Results are merged **field by field, in priority order**, taking the first non-empty value:

- title, authors and year from the first source that has them (Open Library first);
- subjects from all sources, cleaned and de-duplicated (section 7);
- classification from the best available (section 6).

A **blank record is only created if every source answered "not found"**. If sources errored (rate limit, timeout) and nothing was found, the app saves the ISBN as an incomplete row and tells the user why, so nothing is lost and the lookup can be repeated.

### 5.4 Trap: Crossref returns chapters

**[confirmed]** Querying Crossref by the ISBN of a Yale University Press book returned 14 records, **all chapters** (`type: book-chapter`), each carrying the book's title only in `container-title`. The first record was the "Epilogue", and the app briefly saved the book as "Epilogue".

Rule: prefer a record whose type is `book`, `monograph`, `edited-book` or `reference-book`. If only chapters exist, use the chapters' `container-title` as the book title and **ignore the chapter authors** (they are not the book's authors).

### 5.5 Trap: Google Books rate limits

- Without an API key, requests are charged to a shared anonymous pool. **[confirmed]** Google's own error for our requests said the limit for that pool was **0 queries per day**, so keyless use was effectively blocked.
- With our own key (free, created in Google Cloud Console), the project showed a **1,000 queries per day** limit. **[confirmed]** Traffic reached our project. However, the phone continued to receive **HTTP 503** from Google Books for the test books, and we did not resolve why. We chose to stop depending on Google Books for categories (section 6).
- A "free text" Google Books query (`q=9780...` without `isbn:`) can return the wrong book. We only accept a result if its `industryIdentifiers` contain the scanned ISBN.

**Advice:** treat Google Books as an optional extra, never as the foundation. Budget for it failing.

### 5.6 Coverage reality check

**[confirmed]** Very new, small-press or specialist titles are often missing from free databases. One 2024 hardback from a major UK publisher returned nothing from Open Library, Crossref or Google Books, while a retail ISBN site had it. Expect a long tail of books that need either manual entry or title search. A school library with curriculum and children's titles may hit this more or less often than a personal academic library; measure it early with a sample of your own stock.

---

## 6. Categories: the core of the accuracy problem

Libraries do not want retail genres. They want a stable classification. We tried several approaches; this is the order the app now uses, **stopping at the first one that gives an answer**:

| Rank | Source | Why it sits here |
|---|---|---|
| 1 | **Google Books categories** | Good when present, but unavailable to us in practice |
| 2 | **Dewey Decimal class from Open Library**, majority vote | The standard used by most school libraries; coverage is good |
| 3 | **Library of Congress class**, majority vote, mapped into the same categories | Open Library holds an LCC number for many more books than a Dewey number |
| 4 | **Subject keywords** (a rule-based guess), flagged "check this" | Last resort before AI |
| 5 | **AI suggestion** from title, author and any subjects | Fills what is still empty, with a confidence rating |

### 6.1 The one-taxonomy rule

Dewey and LCC use different top-level names ("Philosophy & psychology" vs "Philosophy, psychology, religion"). If both were shown as-is, the same subject would appear under different category names. We map everything into **one fixed list of ten main categories** (the Dewey main classes, renamed to plain English) and a free-text sub-category:

`General works & computing`, `Philosophy & psychology`, `Religion`, `Social sciences`, `Language`, `Science`, `Technology`, `Arts & recreation`, `Literature`, `History & geography`.

The AI is constrained to the same ten, using a JSON schema with an enumerated list, so it cannot invent new top-level categories.

### 6.2 Trap: Open Library's classification is merged across editions

**[confirmed with real data]** For *Harry Potter and the Philosopher's Stone*, Open Library returned this Dewey list:

```text
["028.5", "[Fic]", "j823.914", "839.3636", "823.92", "823", "468", "823.914", "873.57"]
```

That mixes children's reading (`028.5`), fiction (`[Fic]`), English literature (`823`), Dutch (`839`), Spanish (`468`) and Latin (`873`) from different editions and translations. Taking the **first** value gave the wrong main category. The fix:

1. Ignore entries with no leading digits (`[Fic]`) and strip leading letters (`j823.914` becomes `823`).
2. Reduce each to its three-digit class.
3. Pick the **most common** class (823 here). Ties go to the earliest.
4. Map hundreds to the main category and tens to the sub-category (`823` becomes *Literature › English literature*).

The same logic applies to the LCC list (for example, many `PZ` entries beat a few `PR` entries; we accepted that for children's fiction).

### 6.3 What this means for a school

- Schools typically shelve by Dewey; using Open Library's Dewey numbers as a **suggestion**, then letting the librarian confirm, fits that workflow.
- Dewey numbers differ between libraries and editions (abridgement levels, local practice). Treat any imported number as a starting point.
- If you need exact shelf marks, you will probably need **commercial bibliographic data** or your library system's own records. This is general knowledge **[assumed]**, not tested here.

---

## 7. Tags, concepts and the AI step

### 7.1 Cleaning tags from Open Library

Open Library's `subject` list contains useful headings and a lot of bookkeeping. We drop any tag that contains `:` or `_` (for example `series:Harry_Potter`, `nyt:children-books=2001`), is longer than 59 characters, or matches a short junk list (such as "Accessible book", "Protected DAISY", "In library", "Lending library", "Overdrive", "reading level-..."). Tags are de-duplicated case-insensitively and capped at 20.

### 7.2 What the AI step does

After the databases have answered, any still-empty field among **category, sub-category, tags, key concepts and description** is requested from Claude. Key concepts (the specific ideas, themes, traditions or thinkers a book engages with) are never provided by the databases, so every book goes through this step.

**Architecture**

- The phone sends the book's known fields to the Google script; the script calls the Claude API with the secret key kept in the script's settings. The key never reaches the phone or the public code.
- One request at a time, in the background after a scan, so scanning stays fast.
- Output is constrained by a **JSON schema** (category from the fixed list; confidence one of `high`, `medium`, `low`), so the reply is always parseable.
- The prompt asks the model to use what it actually knows, to infer cautiously and mark `low` confidence if it does not recognise the book, and never to invent claims, plot or quotations.

**Safeguards that matter**

| Safeguard | How |
|---|---|
| Never overwrite database data | Only empty fields are filled |
| Provenance | A *Source* column records, for example, `Category: Dewey class | AI-suggested (medium confidence): concepts, description` |
| Human check | The *Suggest with AI* button fills the edit form for review before saving |
| Failure is quiet but visible | The background step stays silent on error; the button shows the real error message |
| Setup problems stop a batch | The batch job stops and says why (for example, missing key), rather than failing on every book |

**Cost.** Roughly a penny or two per book on the more capable model, using the published prices (about $4 per million input tokens and $20 per million output tokens) and our estimate of a few hundred input tokens and a few hundred output tokens per book **[assumed: actual spend not measured here; check your console]**. A much cheaper, less nuanced model is available. For a library of 5,000 books, work out the cost on a sample before committing.

**Quality.** The user reviewed a book that had been entirely empty and described the AI result as "perfect". That is encouraging for well-known titles. It is **not** evidence about obscure, local or children's titles. The AI can be confidently wrong about a book it half-recognises. Keep the confidence rating and the source note, and sample-check the output.

---

## 8. Identifiers and links

The goal was a catalogue that can later be linked with other data, so each book carries stable identifiers:

| Field | Value | Purpose |
|---|---|---|
| ISBN-13 | the barcode | Primary key |
| Work ID | Open Library work key (e.g. `OL82563W`) | Groups all editions of the same work |
| Author ID | Wikidata QID where known, plus the Open Library author key, separated by `;` | Lets authors be linked to other datasets |
| Catalogue link | Open Library work page; WorldCat ISBN search if no work exists | A permanent, open record rather than a shop |
| Amazon link | `amazon.co.uk/dp/<ISBN-10>` for 978 ISBNs; an ISBN search link for 979 | Kept because it was in the original brief |

**Why not scrape Amazon or Goodreads for data?** Following a link is fine. Reading those pages automatically is restricted by their terms, is blocked by the browser's cross-site rules, and breaks without warning. Goodreads no longer offers a public data feed. We used link-only for both.

**One honest limit:** WorldCat and Open Library ISBN links were not opened and checked during development for every case; the catalogue link is a best-available permanent address, not a guarantee that a record exists.

---

## 9. Storage and sync

### 9.1 The sheet

One tab named **Books**. The script finds columns **by their heading text**, not by position, so older sheets keep working: any missing columns are appended on the right the next time the script runs. Existing rows are updated in place and unknown columns are preserved. ISBN and year columns are formatted as plain text, otherwise the sheet turns `9780747532743` into `9.78E+12`.

### 9.2 How the phone talks to the script

- A `POST` with `Content-Type: text/plain` (not JSON), because a JSON content type triggers a browser pre-flight request that Apps Script cannot answer.
- The body contains a shared secret key, and either a list of changes (`put` / `del`) or an `enrich` action for the AI step.
- The script takes a lock while writing so two devices cannot corrupt the sheet. The AI action runs **before** taking the lock, so a slow API call does not block syncing.

### 9.3 Things that bit us

| Problem | Cause | Fix |
|---|---|---|
| Sync returned a web page with HTTP 404 | The Apps Script deployment had been replaced, so the old URL no longer existed | Create a deployment and paste the new `/exec` URL. After editing the script, deploy a **new version of the existing deployment** to keep the URL |
| "Bad key" | Key in the app did not match the script, or the deployment still ran the old code | Re-enter the key; redeploy a new version after editing |
| Sync "worked" but returned a Google sign-in page | Access was set to *Only me* | Set *Who has access* to *Anyone* (the secret key is then the only protection) |
| Service worker cached sync responses | The first version cached every GET | Never cache API or sync calls |
| Error text hid the real cause | Generic "could not upload" message | Show the underlying error |

---

## 10. Exploring the collection

All of this is calculated on the phone from the stored fields, so it needs no extra service.

- **Filter by a facet:** tap a concept, tag, author or category. Co-authors are split, so a book by "A, B" appears under both.
- **Related books:** every other book is scored by what it shares with the current one, and the top eight are shown with the reasons:

| Shared | Score |
|---|---|
| Author | 5 each |
| Key concept | 3 each |
| Sub-category | 2 |
| Tag | 1 each |
| Category (when the sub-category differs) | 1 |

These weights are a judgement, not tuned on data. They gave sensible results on a small test set **[tested with mocks]**; check them on a real collection.

---

## 11. Engineering lessons

1. **Test the awkward cases with real data, not invented data.** The two most important bugs (the merged Dewey list and the Crossref chapters) only showed up when real API output was pasted in.
2. **Make every failure visible and non-destructive.** A scan should never vanish. The app saves the ISBN, says what went wrong, and offers to retry.
3. **Provenance beats polish.** A *Source* column that says where a value came from is worth more than an extra feature.
4. **Installed web apps hold on to old code.** We switched the service worker to "network first" for the app's own files so updates arrive on the next open. Until then, the phone kept running an old copy even after fixes were published. Version your cache and test the update path on a real phone.
5. **Free tiers need an exit plan.** Google Books became unusable; because the app was built to merge several sources, it carried on.
6. **Keep secrets out of the repository and off the phone.** The AI key lives in the script's settings. The sheet key and the Google key sit in the phone's local storage, not in code.
7. **Check what a key really does.** An API key restricted to one website and one API still passes through the browser.

---

## 12. Recommendations for a school library app

*This section is advice, drawn from what we learned plus general knowledge. Nothing here has been built or tested for a school.*

### 12.1 What transfers directly

- ISBN validation and the multi-source merge.
- Barcode scanning with the WASM decoder, manual entry and photo fallback.
- The "never overwrite, always record the source" rule.
- The category pipeline (Dewey majority first), with a librarian confirming the result.
- Offline-first behaviour, useful where school Wi-Fi is poor.

### 12.2 What must change

| Area | Personal prototype | What a school needs |
|---|---|---|
| **Users** | One person | Several staff and possibly pupils, each with their own login and permissions |
| **Storage** | A spreadsheet behind a secret URL | A proper database with authentication. A shared secret in a URL is not acceptable for personal data about children |
| **Student data** | None | If loans record pupil names, that is personal data about children. Involve the school's data protection lead early; decide what to store, who can see it, and how long you keep it. UK schools are subject to UK GDPR **[assumed to apply; confirm locally]** |
| **Copies** | One row per ISBN | Many copies of the same ISBN, each needing its own identity (an accession or copy number), condition, location and loan status. The ISBN identifies the *title*, not the physical *copy* |
| **Barcodes** | Scan the publisher's ISBN | Most school systems stick their own barcode on each copy. A scan then means "this copy", and the ISBN is data attached to it |
| **Loans** | (Parked) | Check out, return, renew, overdue, reservations, and a history per copy and per pupil |
| **Standards** | Personal categories | Dewey shelf marks, and ideally export and import in library standard formats so the school can move systems. MARC21 is the common record format **[assumed]** |
| **Age and reading level** | Not available | Pupils need age range and reading level. The free sources we used do not provide these reliably. Look at what your library system or supplier offers |
| **Stock-take** | Scan and see | Bulk scanning of an existing shelf with a report of books not found or scanned twice |
| **Accessibility and safeguarding** | Not considered | Required for a school: accessible design, appropriate content handling, and audit of who changed what |

### 12.3 Build, adopt or integrate?

Before writing a lot of code, compare with **existing library management systems**. Schools already use products such as Accessit and Heritage, and open-source systems such as Koha exist **[assumed: general knowledge; verify current products and costs]**. Your friend's app may be most valuable as:

- a **fast scanning and stock-taking tool** that feeds an existing system, or
- a **lightweight catalogue** for a small library that cannot afford a full system.

Decide this first; it determines how much of the above you must build.

### 12.4 Data sourcing at school scale

- **Rate limits become real.** Hundreds or thousands of books scanned in a session will hit free limits. Cache results centrally (look up each ISBN once, store it, reuse for every later copy and every school).
- **Open Library offers bulk data downloads** **[assumed: confirm current location and licence]**; for a large collection, loading a local copy avoids hammering the live API.
- **Commercial bibliographic data** (the standard in the book trade and in libraries) is more complete and consistent, and includes age and subject data, but costs money **[assumed]**. Compare with the cost of cleaning free data by hand.
- **Measure coverage first.** Take 100 real books from the school shelves, run the lookups, and count how many return a full record. That number should decide your data strategy.
- **Children's books and school editions** may sit in odd corners of the free databases (custom school editions, reading-scheme titles). We did not test any children's stock beyond one famous title.

### 12.5 If AI is used

- Keep it as a **suggestion** with confidence and source recorded, as here.
- **Never send pupil data** to an AI service. Book metadata only.
- Record which model and prompt version produced each suggestion, so results can be re-run or audited.
- Budget with a sample; keep a spending cap on the account.
- For a school, a suggested *reading level* or *age range* from an AI would be a judgement about children's content. Treat any such field as advisory and have a person approve it.

### 12.6 Suggested build order for the school app

1. Pick the user roles and the data you must **not** hold. Settle student-data questions first.
2. Choose a real database and login (not a spreadsheet).
3. Model **title** (the ISBN record) and **copy** (the physical item with its own barcode) as separate things.
4. Build scanning, the lookup pipeline and manual correction, using the lessons in sections 4 to 6.
5. Run a coverage test on real stock and adjust the data sources.
6. Add loans and returns, with privacy rules built in.
7. Only then add enrichment (AI, related books, concepts).

---

## 13. What has and has not been verified

| Claim | Status |
|---|---|
| html5-qrcode failed on a dark-background barcode in our tests; zxing-wasm succeeded | **Tested** in an automated browser with synthetic barcodes and a real phone screenshot |
| zxing-wasm reads real book barcodes on a phone | **Confirmed** by the user for several books; one glossy label still failed |
| Open Library Dewey lists are merged across editions | **Confirmed** from real data |
| Crossref returns chapters under a book's ISBN | **Confirmed** from real data |
| Google Books anonymous quota was zero; own-key quota 1,000 per day | **Confirmed** from Google's responses and the console |
| Google Books HTTP 503 with a valid key | **Observed on the phone; cause not determined** |
| Open Library work description and Wikidata author link | **Tested with mocks only**; the real response shape was not inspected during development |
| LCC majority-vote category | **Tested with mocks** and one real LCC list; not seen end-to-end on a real academic book |
| AI category, tags, concepts, description | **Confirmed by the user** on a previously empty book; **quality on obscure titles unknown** |
| Cost per book | **Estimate only** |
| Related-books ranking weights | **Judgement, tested on a handful of mock books** |
| Catalogue links (Open Library, WorldCat) always resolve | **Not checked** |
| All statements in section 12 about schools, GDPR, MARC21, other products, bulk data and commercial data | **General knowledge, not verified** |
| Behaviour on Android | **Not tested** (the user's phone is an iPhone) |

---

## Appendix A: Sheet columns

`ISBN`, `Title`, `Author`, `Original publication`, `Main category`, `Sub category`, `Tags`, `Catalogue link`, `Amazon link`, `Description`, `Key concepts`, `Work ID`, `Author ID`, `Source`, `Added`.

Tags, concepts and author IDs are lists separated by `;`. The script matches columns by heading, so renaming a heading or the **Books** tab makes it create a new column or tab.

## Appendix B: Where things live in the code

| What | Where |
|---|---|
| Whole app (UI, lookup, categories, AI calls, sync client) | `bookscan/index.html` |
| Barcode decoder and its WASM file | `bookscan/zxing.js`, `bookscan/zxing_reader.wasm` |
| Offline and update behaviour | `bookscan/sw.js` (service worker) and `bookscan/manifest.json` |
| Google script (sync, AI call, columns) | `apps-script/Code.gs` |
| Hosting | `.github/workflows/pages.yml` (GitHub Pages) |

Key functions in `index.html`: `lookup` and `SOURCES` (the parallel lookups), `merge` (field-by-field combination), `ddcCats` and `lccCats` (classification), `goodTag` (tag cleaning), `askAI` / `applyAI` / `enrichLater` (AI step), `refreshIncomplete` (batch fill), `relatedScore` (related books).

## Appendix C: Setup checklist for a new copy

1. Public GitHub repository; Pages source set to *GitHub Actions*.
2. A Google Sheet with the script pasted in; a long random value in `KEY`; deploy as a **Web app**, *Execute as: Me*, *Who has access: Anyone*; copy the `/exec` URL.
3. In Script properties, add `ANTHROPIC_KEY` if you want the AI step.
4. In the app, paste the URL and key, then **Sync now**.
5. Spend limit set on the AI account.
6. Install to the phone's home screen from the browser's share menu.

*(Note for a school: this is the personal-prototype setup. Section 12 explains why it is not suitable as-is for pupil data.)*

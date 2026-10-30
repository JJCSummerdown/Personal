// BookScan backup: paste into a Google Sheet's Extensions → Apps Script, set KEY, then Deploy → Web app.
const KEY = 'CHANGE-ME-to-a-long-random-string';

// app field -> column heading. Columns are found by heading, so existing sheets keep working and new columns are added on the right.
const COLUMNS = [
  ['isbn', 'ISBN'], ['title', 'Title'], ['author', 'Author'], ['published', 'Original publication'],
  ['category', 'Main category'], ['subcategory', 'Sub category'], ['tags', 'Tags'],
  ['link', 'Catalogue link'], ['amazon', 'Amazon link'], ['description', 'Description'], ['concepts', 'Key concepts'],
  ['workId', 'Work ID'], ['authorId', 'Author ID'], ['source', 'Source'], ['added', 'Added'],
  ['lentTo', 'Lent to'], ['lentOn', 'Lent on'], ['loanLog', 'Loan history'],
];

// returns the Books sheet and { field: 0-based column index }, creating the sheet / any missing columns
function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Books');
  if (!sh) { sh = ss.insertSheet('Books'); sh.setFrozenRows(1); }
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  COLUMNS.forEach(([, h]) => {
    if (header.indexOf(h) < 0) { header.push(h); sh.getRange(1, header.length).setValue(h); }
  });
  const idx = {};
  COLUMNS.forEach(([f, h]) => idx[f] = header.indexOf(h));
  sh.getRange(1, idx.isbn + 1, sh.getMaxRows(), 1).setNumberFormat('@');          // keep ISBNs as text (no 9.78E+12)
  sh.getRange(1, idx.published + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, idx.lentOn + 1, sh.getMaxRows(), 1).setNumberFormat('@');           // keep yyyy-mm-dd as text, not a date
  return { sh, idx, width: header.length };
}
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

// ---------- AI suggestions ----------
// Needs your Anthropic API key stored as a Script property named ANTHROPIC_KEY (Project Settings -> Script properties).
// The key lives only here: it is never sent to the phone or stored in the sheet.
const MODEL = 'claude-opus-5-5';      // for a much cheaper (and somewhat less nuanced) option use 'claude-haiku-5-5'
const MAIN_CATEGORIES = ['General works & computing', 'Philosophy & psychology', 'Religion', 'Social sciences', 'Language',
  'Science', 'Technology', 'Arts & recreation', 'Literature', 'History & geography'];
const SYSTEM = 'You help catalogue a personal library of mostly academic and serious non-fiction books (theology, philosophy, history, literature, social science). ' +
  'For each book you receive, return one short structured record. Be accurate: use what you actually know about the book. If you do not recognise it, ' +
  'infer cautiously from the title, author and any subject headings supplied, and set confidence to "low". Never invent claims, plot or quotations. ' +
  'Fields: category = exactly one of the allowed main categories; subcategory = a short consistent field name of 1-4 words (e.g. "Christian theology", ' +
  '"Contemplative practice", "Political philosophy"); tags = 5-10 broad subject tags of 1-3 words, useful for browsing; ' +
  'concepts = 4-8 specific ideas, themes, traditions or thinkers the book engages with, as short noun phrases, most specific first; ' +
  'description = 2-3 plain sentences on what the book is about, or an empty string if a description was supplied; ' +
  'confidence = high (you know this book), medium (you know the author and field), or low (inferring from title alone). Do not use semicolons inside any item.';
const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: MAIN_CATEGORIES },
    subcategory: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    concepts: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['category', 'subcategory', 'tags', 'concepts', 'description', 'confidence'],
  additionalProperties: false,
};

function enrich_(book) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_KEY is not set in the script properties');
  const known = {};
  ['title', 'author', 'published', 'category', 'subcategory', 'tags', 'description'].forEach(f => { if (book[f]) known[f] = String(book[f]).slice(0, 1500); });
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: 'Book to catalogue (what the databases already know):\n' + JSON.stringify(known) }],
    }),
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + text.slice(0, 300));
  const reply = JSON.parse(text);
  if (reply.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const out = (reply.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const s = JSON.parse(out);
  const clean = v => String(v || '').replace(/;/g, ',').trim();
  return {
    category: MAIN_CATEGORIES.indexOf(s.category) >= 0 ? s.category : '',
    subcategory: clean(s.subcategory),
    tags: (s.tags || []).map(clean).filter(Boolean).slice(0, 10),
    concepts: (s.concepts || []).map(clean).filter(Boolean).slice(0, 8),
    description: String(s.description || '').trim(),
    confidence: ['high', 'medium', 'low'].indexOf(s.confidence) >= 0 ? s.confidence : 'low',
  };
}

function doGet(e) {
  if (!e || !e.parameter || (e.parameter.key || '') !== KEY) return json_({ ok: false, error: 'bad key' });
  const { sh, idx, width } = sheet_(), last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  const books = rows.filter(r => r[idx.isbn]).map(r => {
    const b = {};
    COLUMNS.forEach(([f]) => b[f] = String(r[idx[f]] ?? ''));
    return b;
  });
  return json_({ ok: true, books });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (body.key !== KEY) return json_({ ok: false, error: 'bad key' });
  if (body.action === 'enrich') {
    try { return json_({ ok: true, suggestion: enrich_(body.book || {}) }); }
    catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const { sh, idx, width } = sheet_();
    const rowOf = {};
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, idx.isbn + 1, last - 1, 1).getValues().forEach((r, i) => rowOf[String(r[0])] = i + 2);
    const toDelete = [];
    for (const op of body.ops || []) {
      if (op.t === 'put') {
        let row = rowOf[op.book.isbn];
        const vals = row ? sh.getRange(row, 1, 1, width).getValues()[0] : new Array(width).fill('');   // keep any columns the app doesn't know about
        COLUMNS.forEach(([f]) => vals[idx[f]] = op.book[f] ?? '');
        if (row) sh.getRange(row, 1, 1, width).setValues([vals]);
        else { sh.appendRow(vals); rowOf[op.book.isbn] = sh.getLastRow(); }
      } else if (op.t === 'del' && rowOf[op.isbn]) {
        toDelete.push(rowOf[op.isbn]); delete rowOf[op.isbn];
      }
    }
    toDelete.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));   // bottom-up so row numbers stay valid
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

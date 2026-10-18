// BookScan backup: paste into a Google Sheet's Extensions → Apps Script, set KEY, then Deploy → Web app.
const KEY = 'CHANGE-ME-to-a-long-random-string';

// app field -> column heading. Columns are found by heading, so existing sheets keep working and new columns are added on the right.
const COLUMNS = [
  ['isbn', 'ISBN'], ['title', 'Title'], ['author', 'Author'], ['published', 'Original publication'],
  ['category', 'Main category'], ['subcategory', 'Sub category'], ['tags', 'Tags'],
  ['link', 'Catalogue link'], ['amazon', 'Amazon link'], ['description', 'Description'], ['concepts', 'Key concepts'],
  ['workId', 'Work ID'], ['authorId', 'Author ID'], ['source', 'Source'], ['added', 'Added'],
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
  return { sh, idx, width: header.length };
}
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

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
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.key !== KEY) return json_({ ok: false, error: 'bad key' });
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

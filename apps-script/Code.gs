// BookScan backup: paste into a Google Sheet's Extensions → Apps Script, set KEY, then Deploy → Web app.
const KEY = 'CHANGE-ME-to-a-long-random-string';
const COLS = ['isbn','title','author','published','category','subcategory','tags','amazon','added'];
const HEAD = ['ISBN','Title','Author','Original publication','Main category','Sub category','Tags','Amazon link','Added'];

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Books');
  if (!sh) {
    sh = ss.insertSheet('Books');
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
  }
  sh.getRange('A:A').setNumberFormat('@');   // keep ISBNs as text (no 9.78E+12, no lost leading zeros)
  sh.getRange('D:D').setNumberFormat('@');
  return sh;
}
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doGet(e) {
  if ((e.parameter.key || '') !== KEY) return json_({ ok: false, error: 'bad key' });
  const sh = sheet_(), last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, COLS.length).getValues() : [];
  const books = rows.filter(r => r[0]).map(r => Object.fromEntries(COLS.map((c, i) => [c, String(r[i] ?? '')])));
  return json_({ ok: true, books });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.key !== KEY) return json_({ ok: false, error: 'bad key' });
    const sh = sheet_();
    const index = {};
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => index[String(r[0])] = i + 2);
    const toDelete = [];
    for (const op of body.ops || []) {
      if (op.t === 'put') {
        const row = COLS.map(c => op.book[c] ?? '');
        if (index[op.book.isbn]) sh.getRange(index[op.book.isbn], 1, 1, COLS.length).setValues([row]);
        else { sh.appendRow(row); index[op.book.isbn] = sh.getLastRow(); }
      } else if (op.t === 'del' && index[op.isbn]) {
        toDelete.push(index[op.isbn]); delete index[op.isbn];
      }
    }
    toDelete.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));   // bottom-up so row numbers stay valid
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

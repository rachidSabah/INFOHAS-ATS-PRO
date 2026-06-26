const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const d1Dir = 'C:\\Users\\InGodWeTrust\\Downloads\\ATS PRO\\.wrangler\\state\\v3\\d1\\miniflare-D1DatabaseObject';
const files = fs.readdirSync(d1Dir);
const sqliteFile = files.find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');

if (!sqliteFile) {
  console.error("No SQLite database found.");
  process.exit(1);
}

const dbPath = path.join(d1Dir, sqliteFile);
console.log("Opening SQLite DB:", dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Failed to open DB:", err);
    process.exit(1);
  }
});

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
  if (err) {
    console.error("Error listing tables:", err);
    return;
  }
  console.log("Tables:", tables.map(t => t.name));

  db.all("SELECT id, name, headline, summary, experience, education, languages FROM resumes", (err, rows) => {
    if (err) {
      console.error("Error querying resumes:", err);
      return;
    }
    console.log(`Found ${rows.length} resumes.`);
    for (const row of rows) {
      console.log(`\n========================================`);
      console.log(`RESUME ID: ${row.id}`);
      console.log(`NAME: ${row.name}`);
      console.log(`HEADLINE: ${row.headline}`);
      console.log(`SUMMARY: ${row.summary}`);
      try {
        const exp = JSON.parse(row.experience);
        console.log(`EXPERIENCE: ${exp.length} items`);
        console.log(JSON.stringify(exp, null, 2));
      } catch {
        console.log(`EXPERIENCE: (raw) ${row.experience}`);
      }
      try {
        const edu = JSON.parse(row.education);
        console.log(`EDUCATION: ${edu.length} items`);
        console.log(JSON.stringify(edu, null, 2));
      } catch {
        console.log(`EDUCATION: (raw) ${row.education}`);
      }
      try {
        const lang = JSON.parse(row.languages);
        console.log(`LANGUAGES: ${lang.length} items`);
        console.log(JSON.stringify(lang, null, 2));
      } catch {
        console.log(`LANGUAGES: (raw) ${row.languages}`);
      }
    }
  });
});

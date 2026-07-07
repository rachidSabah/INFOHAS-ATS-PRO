const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('db/custom.db');

db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log("Tables:", tables);
  
  // Let's query the resumes or similar tables if they exist
  tables.forEach(t => {
    db.all(`SELECT * FROM "${t.name}" LIMIT 5`, [], (err, rows) => {
      if (err) {
        console.error(`Error querying ${t.name}:`, err);
      } else {
        console.log(`\n=== Table: ${t.name} (showing up to 5 rows) ===`);
        console.log(JSON.stringify(rows, null, 2));
      }
    });
  });
});

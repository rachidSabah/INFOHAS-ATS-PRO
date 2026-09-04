// Bisect: apply 0001..0007 then run each 0008 statement to find failures.
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG = "/home/z/my-project/INFOHAS-ATS-PRO/migrations";
const db = new Database(":memory:");

const apply = (file: string) => {
  const sql = readFileSync(join(MIG, file), "utf8");
  db.exec(sql); // comments handled by SQLite
};

const ALL = readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
for (const f of ALL) {
  const sql = readFileSync(join(MIG, f), "utf8");
  const stmts = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim().startsWith("--")));
  let n = 0;
  let failed = false;
  for (const s of stmts) {
    n++;
    try { db.exec(s); }
    catch (e: any) {
      console.log(`FAIL ${f} statement #${n}: ${e.message}`);
      const firstLine = s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("--"))[0] ?? "";
      console.log("  head:", firstLine.slice(0, 110));
      failed = true;
      break;
    }
  }
  if (!failed) console.log("OK  ", f, `(${n} stmts)`);
}
console.log("CHAIN BISECT COMPLETE");

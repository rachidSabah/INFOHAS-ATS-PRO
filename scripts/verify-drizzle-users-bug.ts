// Prove (or disprove) that drizzle's insert on schema.users generates a
// "createdAt" column that does not exist in the real D1 users table.
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../workers/api/schema";

const fakeD1 = {
  prepare: () => { throw new Error("should not execute"); },
} as any;

const db = drizzle(fakeD1, { schema });

const q = db
  .insert(schema.users)
  .values({
    id: "user_abc123",
    email: "user_abc123@placeholder.local",
    name: "user_abc123",
    role: "user",
    status: "active",
    provider: "email",
    createdAt: "2026-09-04T10:00:00.000Z",
    updatedAt: "2026-09-04T10:00:00.000Z",
  });

const sql = q.toSQL();
console.log("SQL:", sql.sql);
console.log("PARAMS:", JSON.stringify(sql.params));

if (/"createdAt"/.test(sql.sql)) {
  console.log("\nBUG CONFIRMED: generated SQL uses \"createdAt\" — real D1 table has created_at (snake_case).");
  console.log("=> ensureUserExists() INSERT throws 'table users has no column named createdAt'");
  console.log("=> POST /api/resumes returns 500 for any brand-new user id.");
} else {
  console.log("\nNo bug: SQL uses snake_case columns.");
}

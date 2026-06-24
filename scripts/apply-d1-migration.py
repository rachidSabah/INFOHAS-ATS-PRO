#!/usr/bin/env python3
"""
Apply D1 migration 0003_ai_dev_agent.sql to the Cloudflare D1 database
using the Cloudflare REST API.

The D1 /query endpoint only accepts one statement per call, so we split
the migration file into individual statements and apply them sequentially.
"""
import urllib.request
import urllib.error
import json
import sys
import re
import time
import os

ACCOUNT_ID = "8b0712b4eeadbc197e9363f2a0d8e700"
DATABASE_ID = "4485ee27-7fec-4077-a39d-c5cc4b1b9167"
# Read the token from environment variable instead of hardcoding it.
# Set CF_API_TOKEN before running: export CF_API_TOKEN=cfut_...
CF_TOKEN = os.environ.get("CF_API_TOKEN", "")
MIGRATION_FILE = "/home/z/my-project/migrations/0003_ai_dev_agent.sql"

if not CF_TOKEN:
    print("ERROR: CF_API_TOKEN environment variable is not set.")
    print("Set it with: export CF_API_TOKEN=your_token_here")
    sys.exit(1)

def api_call(sql: str):
    """Execute a single SQL statement on the D1 database."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query"
    body = json.dumps({"sql": sql}).encode()
    req = urllib.request.Request(url, method="POST", data=body, headers={
        "Authorization": f"Bearer {CF_TOKEN}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"success": False, "errors": [{"message": f"HTTP {e.code}: {e.read().decode()[:500]}"}]}
    except Exception as e:
        return {"success": False, "errors": [{"message": str(e)}]}

def split_sql(sql_text: str) -> list:
    """Split SQL into individual statements, handling comments and semicolons."""
    # Remove SQL comments (-- to end of line)
    lines = []
    for line in sql_text.split("\n"):
        # Keep the line if it's not a comment (but preserve lines that have code before the comment)
        if "--" in line:
            # Find the position of -- that's not inside a string
            comment_pos = line.find("--")
            line = line[:comment_pos].rstrip()
        if line.strip():
            lines.append(line)

    full = "\n".join(lines)

    # Split on semicolons, but be careful about semicolons inside strings
    statements = []
    current = ""
    in_string = False
    string_char = None
    i = 0
    while i < len(full):
        c = full[i]
        if in_string:
            current += c
            if c == string_char and (i == 0 or full[i-1] != "\\"):
                in_string = False
                string_char = None
        else:
            if c in ("'", '"'):
                in_string = True
                string_char = c
                current += c
            elif c == ";":
                stmt = current.strip()
                if stmt:
                    statements.append(stmt)
                current = ""
            else:
                current += c
        i += 1

    # Don't forget the last statement if it doesn't end with ;
    last = current.strip()
    if last:
        statements.append(last)

    return statements

def main():
    print("=" * 60)
    print("Applying D1 migration: 0003_ai_dev_agent.sql")
    print("=" * 60)
    print(f"Account:  {ACCOUNT_ID}")
    print(f"Database: {DATABASE_ID} (resumeai-pro-db)")
    print()

    # Read the migration file
    with open(MIGRATION_FILE, "r") as f:
        migration_sql = f.read()

    # Split into individual statements
    statements = split_sql(migration_sql)
    print(f"Found {len(statements)} SQL statement(s) to execute:")
    for i, stmt in enumerate(statements):
        preview = stmt.replace("\n", " ")[:80]
        print(f"  {i+1}. {preview}{'...' if len(stmt) > 80 else ''}")
    print()

    # Execute each statement
    success_count = 0
    fail_count = 0
    for i, stmt in enumerate(statements):
        print(f"[{i+1}/{len(statements)}] Executing: {stmt.replace(chr(10), ' ')[:60]}...")
        result = api_call(stmt)
        if result.get("success"):
            success_count += 1
            # Show the result
            results = result.get("result", [])
            if results and isinstance(results, list):
                r = results[0]
                if "meta" in r:
                    meta = r["meta"]
                    changes = meta.get("changes", 0)
                    if changes > 0:
                        print(f"  ✓ OK ({changes} row(s) affected)")
                    else:
                        print(f"  ✓ OK")
                else:
                    print(f"  ✓ OK")
            else:
                print(f"  ✓ OK")
        else:
            fail_count += 1
            errors = result.get("errors", [])
            err_msg = errors[0].get("message", "unknown error") if errors else "unknown error"
            # Check if it's a "table already exists" error (which is fine for IF NOT EXISTS)
            if "already exists" in err_msg.lower():
                print(f"  ✓ Already exists (skipping)")
                success_count += 1
                fail_count -= 1
            else:
                print(f"  ✗ FAILED: {err_msg[:200]}")
        time.sleep(0.3)  # small delay to avoid rate limits

    print()
    print("=" * 60)
    print(f"Migration complete: {success_count} succeeded, {fail_count} failed")
    print("=" * 60)

    # Verify tables exist
    print("\nVerifying tables...")
    verify_result = api_call("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_agent%';")
    if verify_result.get("success"):
        results = verify_result.get("result", [])
        if results and isinstance(results, list):
            rows = results[0].get("results", [])
            if rows:
                print(f"  ✓ Found {len(rows)} AI agent table(s):")
                for row in rows:
                    print(f"    - {row.get('name')}")
            else:
                print("  ✗ No AI agent tables found")
    else:
        print(f"  ✗ Verification failed: {verify_result.get('errors', [])}")

    # Verify indexes
    print("\nVerifying indexes...")
    verify_idx = api_call("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_ai_agent%';")
    if verify_idx.get("success"):
        results = verify_idx.get("result", [])
        if results and isinstance(results, list):
            rows = results[0].get("results", [])
            if rows:
                print(f"  ✓ Found {len(rows)} index(es):")
                for row in rows:
                    print(f"    - {row.get('name')}")
            else:
                print("  ✗ No AI agent indexes found")

    # Verify default settings row
    print("\nVerifying default settings row...")
    verify_settings = api_call("SELECT id, model_name, reasoning_level, safe_apply_enabled FROM ai_agent_settings;")
    if verify_settings.get("success"):
        results = verify_settings.get("result", [])
        if results and isinstance(results, list):
            rows = results[0].get("results", [])
            if rows:
                print(f"  ✓ Default settings row exists:")
                for row in rows:
                    print(f"    - id={row.get('id')}, model={row.get('model_name')}, reasoning={row.get('reasoning_level')}, safe_apply={row.get('safe_apply_enabled')}")

    if fail_count > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()

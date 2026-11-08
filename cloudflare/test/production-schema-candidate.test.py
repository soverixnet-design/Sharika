"""Offline preflight for the isolated, not-yet-deployed production candidate.

This test uses only an in-memory SQLite database. It never opens a remote D1,
copies staging user data, or mutates Cloudflare resources.
"""

from pathlib import Path
import sqlite3


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "production-schema" / "0001_staging_structural_candidate.sql"
SEEDS = ROOT / "production-schema" / "0002_curated_defaults_candidate.sql"


def count_rows(connection, table):
    return connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]


def total_sharika_rows(connection):
    tables = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sharika_%'"
    ).fetchall()
    return sum(count_rows(connection, name) for (name,) in tables)


def main():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    db.executescript(SEEDS.read_text(encoding="utf-8"))

    counts = dict(db.execute(
        "SELECT type,count(*) FROM sqlite_master WHERE sql IS NOT NULL "
        "AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV','d1_migrations') "
        "GROUP BY type"
    ).fetchall())
    assert counts == {"table": 154, "index": 112, "trigger": 140}, counts
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []

    # All seeded rows come from static local migration defaults, never users.
    assert total_sharika_rows(db) == 103
    for table in (
        "sharika_users", "sharika_wallet_ledger", "sharika_gift_events",
        "sharika_agency_earnings", "sharika_agency_salary_seller_transfers",
        "sharika_admin_direct_recharges", "sharika_family_policy",
        "sharika_cosmetics_catalog", "sharika_lucky_box_pool",
        "sharika_google_play_purchases",
    ):
        assert count_rows(db, table) == 0, table

    assert db.execute(
        "SELECT host_bps, agency_bps, bd_bps FROM sharika_agency_policy "
        "WHERE key='standard'"
    ).fetchone() == (4000, 1000, 500)
    assert [row[0] for row in db.execute(
        "SELECT target_coins FROM sharika_agency_salary_targets ORDER BY target_coins"
    )] == [1_000_000, 2_500_000, 5_000_000, 10_000_000]
    assert db.execute(
        "SELECT min_host_target_coins FROM sharika_agency_salary_config "
        "WHERE key='standard'"
    ).fetchone()[0] == 5_000_000
    assert db.execute("SELECT enabled FROM sharika_lucky_box_settings").fetchone()[0] == 0
    assert db.execute(
        "SELECT enabled FROM sharika_game_catalog WHERE id='jackpot-fruit'"
    ).fetchone()[0] == 0

    # The reviewed source guard, unlike the older staging copy, rejects minors.
    trigger_sql = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='trigger' "
        "AND name='sharika_agency_salary_seller_guard'"
    ).fetchone()[0]
    assert "u.minor=0" in trigger_sql
    staff_sql = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='trigger' "
        "AND name='sharika_staff_direct_recharge_limit'"
    ).fetchone()[0]
    assert "expires_at_ms" in staff_sql and "coin_recharge" in staff_sql

    # Safe defaults can be retried without minting or duplicating anything.
    db.executescript(SEEDS.read_text(encoding="utf-8"))
    assert total_sharika_rows(db) == 103
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    print("Production candidate PASS: 154 app tables, 112 indexes, 140 triggers, 103 safe defaults")


if __name__ == "__main__":
    main()

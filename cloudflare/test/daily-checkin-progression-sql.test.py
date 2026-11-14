import sqlite3
from pathlib import Path

migrations = Path(__file__).resolve().parents[1] / 'migrations'
db = sqlite3.connect(':memory:')
db.executescript("""
PRAGMA foreign_keys=ON;
CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY);
INSERT INTO sharika_users VALUES ('alice');
""")
db.executescript((migrations / '0010_daily_rewards.sql').read_text())
db.execute("INSERT INTO sharika_daily_checkins VALUES ('alice','2026-11-13',1,100,'2026-11-13')")
db.executescript((migrations / '0082_daily_checkin_progression.sql').read_text())
assert db.execute("SELECT reward_coins, created_at FROM sharika_daily_checkins").fetchone() == (100, '2026-11-13')
db.execute("UPDATE sharika_daily_reward_config SET day1=100000,day7=400000")
db.execute("INSERT INTO sharika_daily_checkins VALUES ('alice','2026-11-14',2,150000,'2026-11-14')")
for statement in [
    "UPDATE sharika_daily_reward_config SET day1=1000001",
    "UPDATE sharika_daily_checkins SET reward_coins=5",
    "DELETE FROM sharika_daily_checkins",
    "INSERT INTO sharika_daily_checkins VALUES ('alice','2026-11-14',2,150000,'2026-11-14')",
]:
    try:
        db.execute(statement)
    except sqlite3.IntegrityError:
        continue
    raise AssertionError(statement)
assert not db.execute("PRAGMA foreign_key_check").fetchall()

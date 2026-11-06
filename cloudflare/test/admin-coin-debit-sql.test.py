"""Validate additive virtual coin debit receipts without touching staging D1."""
import pathlib
import sqlite3
import unittest

HERE = pathlib.Path(__file__).resolve().parents[1]


class DebitMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript((HERE / 'migrations/0001_initial.sql').read_text())
        self.migration = (HERE / 'migrations/0071_admin_virtual_coin_debits.sql').read_text()
        self.db.executescript(self.migration)
        self.db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor) "
                        "VALUES (10000001,'super-id','Super','1990-01-01',0)")
        self.db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
                        "VALUES (10000017,'recipient-id','Recipient','1990-01-01',0,500)")

    def tearDown(self):
        self.db.close()

    def test_migration_is_additive_and_idempotent(self):
        self.db.executescript(self.migration)
        amount = 200
        self.db.execute('UPDATE sharika_users SET coins=coins-? WHERE auth_uid=?',
                        (amount, 'recipient-id'))
        self.db.execute('INSERT INTO sharika_admin_coin_adjustments '
                        '(actor_uid,recipient_uid,coins,reason,request_id,balance_after) '
                        'VALUES (?,?,?,?,?,?)',
                        ('super-id','recipient-id',amount,'Correct accidental credit',
                         'debit-20261106-0001',300))
        self.db.execute('INSERT INTO sharika_wallet_ledger '
                        '(auth_uid,currency,delta,balance_after,reason,request_id) '
                        "VALUES (?,'coins',?,?,'admin_virtual_coin_debit',?)",
                        ('recipient-id',-amount,300,'admin-debit:super-id:debit-20261106-0001'))
        self.assertEqual(self.db.execute("SELECT coins FROM sharika_users WHERE auth_uid='recipient-id'")
                         .fetchone()[0],300)
        self.assertEqual(self.db.execute('SELECT delta FROM sharika_wallet_ledger').fetchone()[0],-200)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE sharika_admin_coin_adjustments SET coins=1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('DELETE FROM sharika_admin_coin_adjustments')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO sharika_admin_coin_adjustments '
                            '(actor_uid,recipient_uid,coins,reason,request_id,balance_after) '
                            'VALUES (?,?,?,?,?,?)',
                            ('super-id','recipient-id',100,'Another correction',
                             'debit-20261106-0001',200))


if __name__ == '__main__':
    unittest.main()

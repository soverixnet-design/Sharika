-- Applications collect intent only. They NEVER grant administrative rights.
CREATE TABLE IF NOT EXISTS sharika_role_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  requested_role TEXT NOT NULL CHECK(requested_role IN
    ('manager','bd','admin','super','coin_seller')),
  country TEXT NOT NULL CHECK(length(country) BETWEEN 2 AND 60),
  contact TEXT NOT NULL CHECK(length(contact) BETWEEN 5 AND 120),
  experience TEXT NOT NULL CHECK(length(experience) BETWEEN 20 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
    ('pending','shortlisted','rejected')),
  reviewer_uid TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sharika_role_applications_one_pending
  ON sharika_role_applications(applicant_uid,requested_role)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_sharika_role_applications_review
  ON sharika_role_applications(status,created_at DESC);

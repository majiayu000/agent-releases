CREATE TABLE cursors (
  product TEXT PRIMARY KEY,
  version TEXT NOT NULL
);
CREATE TABLE publications (
  product TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted')),
  text TEXT NOT NULL,
  tweet_id TEXT,
  reserved_at TEXT NOT NULL,
  day TEXT NOT NULL,
  posted_at TEXT,
  PRIMARY KEY (product, version)
);
-- A pending X request blocks all further publication, including overlapping cron runs.
CREATE UNIQUE INDEX one_pending_publication ON publications ((1)) WHERE status = 'pending';
CREATE INDEX publications_day ON publications (day);

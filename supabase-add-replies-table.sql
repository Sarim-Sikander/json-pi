-- ============================================================
-- Json-Pi: Replies table for tracking sent email replies
-- Run this in Supabase SQL Editor AFTER you've already run
-- supabase-setup.sql (which creates the contacts table).
-- ============================================================

CREATE TABLE IF NOT EXISTS replies (
  id          BIGSERIAL PRIMARY KEY,
  contact_id  BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  resend_id   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS replies_contact_id_idx ON replies(contact_id);
CREATE INDEX IF NOT EXISTS replies_created_at_idx ON replies(created_at DESC);

ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
-- No policies = only service_role key can read/write.

-- Verify with:
--   SELECT count(*) FROM replies;

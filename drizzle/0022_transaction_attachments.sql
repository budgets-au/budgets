-- Receipt / image / PDF files attached to a transaction. Multiple
-- attachments per transaction (an itemised receipt and a total page;
-- a warranty + its invoice; etc.). The actual bytes live on disk at
-- <dataDir>/attachments/<profileId>/<id>.enc, AES-256-GCM-encrypted
-- under a 32-byte DEK stored in app_settings. The DB only holds the
-- metadata.
--
-- The DEK itself rides inside the SQLCipher file, so rotating the
-- operator passphrase via /rekey re-encrypts the page carrying the
-- DEK alongside every other page — the DEK bytes stay the same and
-- previously-encrypted attachment files remain readable. No
-- file-level re-encryption is required on rekey.
--
-- Added 0.353.
CREATE TABLE transaction_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL
    REFERENCES transactions(id) ON DELETE CASCADE,
  -- Original filename as uploaded. UI only — the on-disk file is named
  -- after the attachment id.
  filename TEXT NOT NULL,
  -- IANA media type (image/jpeg, image/png, application/pdf, etc.).
  -- Enforced on upload by the route's accept-list.
  content_type TEXT NOT NULL,
  -- Plaintext byte count. Capped at 25 MiB in the upload route.
  size INTEGER NOT NULL,
  -- Hex SHA-256 of the plaintext. Captured for integrity checks and
  -- future dedup; not consulted on upload today.
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX transaction_attachments_txn_idx
  ON transaction_attachments(transaction_id);
--> statement-breakpoint
-- Opaque base64 blob holding the DEK (32 random bytes). Populated
-- lazily on first attachment upload via ensureDek(); until then the
-- column is NULL and no attachment files exist. Column is nullable
-- so the migration applies cleanly on every existing DB — including
-- those that never use the feature.
ALTER TABLE app_settings ADD COLUMN attachments_dek TEXT;

ALTER TABLE files ADD COLUMN payload_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN content_format TEXT NOT NULL DEFAULT 'plain';

UPDATE files
SET payload_hash = hash
WHERE payload_hash = '';

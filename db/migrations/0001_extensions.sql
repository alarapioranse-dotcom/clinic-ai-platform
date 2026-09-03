-- Extensions required by docs/technical/01-database-schema.md.
-- Only pgcrypto is needed for this slice (gen_random_uuid()); btree_gist is
-- required by the appointments no-double-booking constraint, which is out of
-- scope here.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

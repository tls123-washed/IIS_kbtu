ALTER TABLE public.users
    ADD COLUMN avatar_jpeg BYTEA CHECK (octet_length(avatar_jpeg) <= 200000),
    ADD COLUMN avatar_version INT NOT NULL DEFAULT 0;

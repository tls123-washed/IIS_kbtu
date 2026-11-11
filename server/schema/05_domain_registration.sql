-- Признак регистрации по окончанию адреса. Подтверждение ящика хранится отдельно.
ALTER TABLE public.users
    ADD COLUMN domain_registration BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT domain_registration_kbtu_email CHECK (
        NOT domain_registration OR email ~ '^[a-z0-9_+%-]+([.][a-z0-9_+%-]+)*@kbtu[.]kz$'
    ),
    ADD CONSTRAINT domain_registration_password CHECK (NOT domain_registration OR password_hash IS NOT NULL);

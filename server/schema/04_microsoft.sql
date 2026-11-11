-- Пароль обязателен для входа по паролю. У аккаунтов Microsoft его может не быть.
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE public.microsoft_identities (
    tenant_id UUID NOT NULL,
    object_id UUID NOT NULL,
    user_id INT NOT NULL UNIQUE REFERENCES public.users(user_id) ON DELETE CASCADE,
    PRIMARY KEY (tenant_id, object_id)
);

CREATE TABLE public.microsoft_flows (
    browser_hash CHAR(64) PRIMARY KEY,
    flow JSONB NOT NULL,
    link_user_id INT REFERENCES public.users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE TABLE public.microsoft_pending (
    browser_hash CHAR(64) PRIMARY KEY,
    tenant_id UUID NOT NULL,
    object_id UUID NOT NULL,
    email VARCHAR(100) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

-- Временные записи OAuth хранятся на сервере. Браузер получает случайный ключ.
CREATE OR REPLACE PROCEDURE campus_api.store_microsoft_flow(p_hash TEXT, p_flow JSONB, p_user INT)
LANGUAGE sql AS $$
    DELETE FROM public.microsoft_flows WHERE expires_at <= now();
    DELETE FROM public.microsoft_pending WHERE expires_at <= now();
    INSERT INTO public.microsoft_flows (browser_hash, flow, link_user_id) VALUES (p_hash, p_flow, p_user);
$$;

CREATE OR REPLACE FUNCTION campus_api.take_microsoft_flow(p_hash TEXT, p_state TEXT)
RETURNS TABLE (flow JSONB, link_user_id INT)
LANGUAGE sql VOLATILE AS $$
    DELETE FROM public.microsoft_flows f
    WHERE f.browser_hash = p_hash::CHAR(64) AND f.expires_at > now() AND f.flow->>'state' = p_state
    RETURNING f.flow, f.link_user_id;
$$;

CREATE OR REPLACE FUNCTION campus_api.microsoft_user(p_tenant UUID, p_object UUID)
RETURNS SETOF campus_api.account_summary
LANGUAGE sql STABLE AS $$
    SELECT a.* FROM campus_api.account_summary a JOIN public.microsoft_identities m USING (user_id)
    WHERE m.tenant_id = p_tenant AND m.object_id = p_object;
$$;

CREATE OR REPLACE FUNCTION campus_api.link_microsoft(p_tenant UUID, p_object UUID, p_user INT, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE AS $$
    WITH linked AS (
        INSERT INTO public.microsoft_identities (tenant_id, object_id, user_id)
        SELECT p_tenant, p_object, u.user_id FROM public.users u
        WHERE u.user_id = p_user AND u.email = p_email AND u.email_verified_at IS NOT NULL
        ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM linked);
$$;

CREATE OR REPLACE FUNCTION campus_api.begin_microsoft_profile(
    p_hash TEXT, p_tenant UUID, p_object UUID, p_email TEXT
)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE AS $$
    WITH pending AS (
        INSERT INTO public.microsoft_pending (browser_hash, tenant_id, object_id, email)
        SELECT p_hash, p_tenant, p_object, p_email
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = p_email)
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM pending);
$$;

CREATE OR REPLACE FUNCTION campus_api.microsoft_profile_email(p_hash TEXT)
RETURNS TABLE (email VARCHAR)
LANGUAGE sql STABLE AS $$
    SELECT p.email FROM public.microsoft_pending p
    WHERE p.browser_hash = p_hash::CHAR(64) AND p.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION campus_api.create_microsoft_student(
    p_hash TEXT, p_tenant UUID, p_username TEXT, p_first TEXT, p_last TEXT, p_year INT, p_faculty INT
)
RETURNS SETOF campus_api.account_summary
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    proof public.microsoft_pending%ROWTYPE;
    student campus_api.account_summary%ROWTYPE;
BEGIN
    DELETE FROM public.microsoft_pending p
    WHERE p.browser_hash = p_hash::CHAR(64) AND p.tenant_id = p_tenant AND p.expires_at > now()
    RETURNING p.* INTO proof;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO STRICT student FROM campus_api.create_student(
        p_username, proof.email, NULL, p_first, p_last, p_year, p_faculty
    );
    INSERT INTO public.microsoft_identities (tenant_id, object_id, user_id)
    VALUES (proof.tenant_id, proof.object_id, student.user_id);
    RETURN NEXT student;
END;
$$;

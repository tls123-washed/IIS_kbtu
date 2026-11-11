-- Аккаунты и сессии. Python передаёт хеши и сам проверяет пароль и код.
CREATE OR REPLACE VIEW campus_api.account_summary AS
SELECT u.user_id, u.username, u.first_name, u.last_name, u.user_type,
       u.first_name || ' ' || u.last_name AS full_name
FROM public.users u;

CREATE OR REPLACE FUNCTION campus_api.faculties()
RETURNS SETOF public.faculties
LANGUAGE sql STABLE AS $$
    SELECT * FROM public.faculties ORDER BY faculty_id;
$$;

CREATE OR REPLACE FUNCTION campus_api.take_rate_limit(p_key TEXT, p_window INTERVAL, p_max INT)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE AS $$
    WITH counted AS (
        INSERT INTO public.auth_limits AS l (rate_key, expires_at)
        VALUES (p_key, now() + p_window)
        ON CONFLICT (rate_key) DO UPDATE SET
            hits = CASE WHEN l.expires_at <= now() THEN 1 ELSE l.hits + 1 END,
            expires_at = CASE WHEN l.expires_at <= now() THEN EXCLUDED.expires_at ELSE l.expires_at END
        WHERE l.expires_at <= now() OR l.hits < p_max
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM counted);
$$;

CREATE OR REPLACE FUNCTION campus_api.store_code(p_email TEXT, p_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE AS $$
    WITH stored AS (
        INSERT INTO public.email_codes AS c (email, code_hash) VALUES (p_email, p_hash)
        ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash,
            sent_at = EXCLUDED.sent_at, expires_at = EXCLUDED.expires_at, attempts = 0
        WHERE c.sent_at <= now() - interval '1 minute'
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM stored);
$$;

CREATE OR REPLACE PROCEDURE campus_api.discard_code(p_email TEXT, p_hash TEXT)
LANGUAGE sql AS $$
    DELETE FROM public.email_codes WHERE email = p_email AND code_hash = p_hash::CHAR(64);
$$;

CREATE OR REPLACE FUNCTION campus_api.try_code(p_email TEXT)
RETURNS TABLE (code_hash TEXT)
LANGUAGE sql VOLATILE AS $$
    UPDATE public.email_codes AS c SET attempts = c.attempts + 1
    WHERE c.email = p_email AND c.expires_at > now() AND c.attempts < 5
    RETURNING c.code_hash::TEXT;
$$;

CREATE OR REPLACE FUNCTION campus_api.create_student(
    p_username TEXT, p_email TEXT, p_password_hash TEXT,
    p_first TEXT, p_last TEXT, p_year INT, p_faculty INT
)
RETURNS SETOF campus_api.account_summary
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    new_id INT;
BEGIN
    INSERT INTO public.users (username, email, password_hash, first_name, last_name, user_type, email_verified_at)
    VALUES (p_username, p_email, p_password_hash, p_first, p_last, 'student', now())
    RETURNING user_id INTO new_id;
    INSERT INTO public.students (user_id, student_number, year_of_study, faculty_id)
    VALUES (new_id, 'u' || new_id, p_year, p_faculty);
    DELETE FROM public.email_codes WHERE email = p_email;
    RETURN QUERY SELECT a.* FROM campus_api.account_summary a WHERE a.user_id = new_id;
END;
$$;

CREATE OR REPLACE PROCEDURE campus_api.create_session(p_hash TEXT, p_user INT)
LANGUAGE sql AS $$
    INSERT INTO public.sessions (token_hash, user_id) VALUES (p_hash, p_user);
$$;

CREATE OR REPLACE FUNCTION campus_api.session_user(p_hash TEXT)
RETURNS SETOF campus_api.account_summary
LANGUAGE sql STABLE AS $$
    SELECT a.* FROM public.sessions s
    JOIN public.users u USING (user_id)
    JOIN campus_api.account_summary a USING (user_id)
    WHERE s.token_hash = p_hash::CHAR(64) AND s.expires_at > now() AND u.email_verified_at IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION campus_api.login_account(p_username TEXT)
RETURNS TABLE (account campus_api.account_summary, password_hash TEXT)
LANGUAGE sql STABLE AS $$
    SELECT a, u.password_hash::TEXT
    FROM public.users u JOIN campus_api.account_summary a USING (user_id)
    WHERE u.username = p_username AND u.email_verified_at IS NOT NULL;
$$;

CREATE OR REPLACE PROCEDURE campus_api.delete_session(p_hash TEXT)
LANGUAGE sql AS $$
    DELETE FROM public.sessions WHERE token_hash = p_hash::CHAR(64);
$$;

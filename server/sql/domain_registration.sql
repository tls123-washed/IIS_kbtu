-- Временная регистрация в пилоте. email_verified_at остаётся пустым до проверки кода.
CREATE OR REPLACE FUNCTION campus_api.create_domain_student(
    p_username TEXT, p_email TEXT, p_password_hash TEXT,
    p_first TEXT, p_last TEXT, p_year INT, p_faculty INT
)
RETURNS SETOF campus_api.account_summary
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    new_id INT;
BEGIN
    INSERT INTO public.users (username, email, password_hash, first_name, last_name, user_type, domain_registration)
    VALUES (p_username, p_email, p_password_hash, p_first, p_last, 'student', TRUE)
    RETURNING user_id INTO new_id;
    INSERT INTO public.students (user_id, student_number, year_of_study, faculty_id)
    VALUES (new_id, 'u' || new_id, p_year, p_faculty);
    RETURN QUERY SELECT a.* FROM campus_api.account_summary a WHERE a.user_id = new_id;
END;
$$;

CREATE OR REPLACE FUNCTION campus_api.session_user(p_hash TEXT, p_allow_domain BOOLEAN)
RETURNS SETOF campus_api.account_summary
LANGUAGE sql STABLE AS $$
    SELECT a.* FROM public.sessions s
    JOIN public.users u USING (user_id)
    JOIN campus_api.account_summary a USING (user_id)
    WHERE s.token_hash = p_hash::CHAR(64) AND s.expires_at > now()
      AND (u.email_verified_at IS NOT NULL OR (p_allow_domain AND u.domain_registration));
$$;

CREATE OR REPLACE FUNCTION campus_api.login_account(p_username TEXT, p_allow_domain BOOLEAN)
RETURNS TABLE (account campus_api.account_summary, password_hash TEXT)
LANGUAGE sql STABLE AS $$
    SELECT a, u.password_hash::TEXT
    FROM public.users u JOIN campus_api.account_summary a USING (user_id)
    WHERE u.username = p_username
      AND (u.email_verified_at IS NOT NULL OR (p_allow_domain AND u.domain_registration));
$$;

-- При возврате кодов пользователь подтверждает адрес и пароль своего пилотного профиля.
CREATE OR REPLACE FUNCTION campus_api.unverified_domain_password(p_username TEXT, p_email TEXT)
RETURNS TABLE (password_hash TEXT)
LANGUAGE sql VOLATILE AS $$
    SELECT u.password_hash::TEXT FROM public.users u
    WHERE u.username = p_username AND u.email = p_email
      AND u.domain_registration AND u.email_verified_at IS NULL
    FOR UPDATE;
$$;

CREATE OR REPLACE FUNCTION campus_api.verify_domain_student(p_username TEXT, p_email TEXT)
RETURNS SETOF campus_api.account_summary
LANGUAGE sql VOLATILE AS $$
    WITH verified AS (
        UPDATE public.users SET email_verified_at = now()
        WHERE username = p_username AND email = p_email
          AND domain_registration AND email_verified_at IS NULL
        RETURNING user_id, username, first_name, last_name, user_type,
                  first_name || ' ' || last_name AS full_name
    ), consumed AS (
        DELETE FROM public.email_codes WHERE email = p_email AND EXISTS (SELECT 1 FROM verified)
    )
    SELECT * FROM verified;
$$;

-- Регистрация по письму удалена. Пользователи и их сессии сохраняются.
DROP FUNCTION IF EXISTS campus_api.store_code(TEXT, TEXT);
DROP PROCEDURE IF EXISTS campus_api.discard_code(TEXT, TEXT);
DROP FUNCTION IF EXISTS campus_api.try_code(TEXT);
DROP FUNCTION IF EXISTS campus_api.unverified_domain_password(TEXT, TEXT);
DROP FUNCTION IF EXISTS campus_api.verify_domain_student(TEXT, TEXT);

-- Этот служебный путь используется после проверки личности Microsoft.
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
    RETURN QUERY SELECT a.* FROM campus_api.account_summary a WHERE a.user_id = new_id;
END;
$$;

DROP TABLE IF EXISTS public.email_codes;

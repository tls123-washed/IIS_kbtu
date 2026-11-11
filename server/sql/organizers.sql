-- Сообщество и роль его создателя появляются в одной транзакции.
CREATE OR REPLACE FUNCTION campus_api.create_community(p_user INT, p_name TEXT, p_description TEXT)
RETURNS INT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    new_id INT;
BEGIN
    INSERT INTO public.communities (name, description)
    VALUES (p_name, NULLIF(p_description, '')) RETURNING community_id INTO new_id;
    INSERT INTO public.community_members (user_id, community_id, role)
    VALUES (p_user, new_id, 'admin');
    RETURN new_id;
END;
$$;

-- Выполняется владельцем проекта из меню Windows или в Query Tool.
CREATE OR REPLACE FUNCTION campus_api.grant_event_organizer(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE AS $$
    WITH target AS (
        SELECT user_id FROM public.users WHERE username = p_username
    ), granted AS (
        INSERT INTO public.event_organizers (user_id)
        SELECT user_id FROM target ON CONFLICT DO NOTHING
    )
    SELECT EXISTS (SELECT 1 FROM target);
$$;

CREATE OR REPLACE FUNCTION campus_api.can_create_event(p_user INT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.event_organizers WHERE user_id = p_user);
$$;

CREATE OR REPLACE FUNCTION campus_api.create_event(
    p_user INT, p_title TEXT, p_description TEXT, p_venue TEXT,
    p_start_local TIMESTAMP, p_capacity INT
)
RETURNS TABLE (event_id INT, outcome TEXT)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    event_start TIMESTAMPTZ := p_start_local AT TIME ZONE 'Asia/Almaty';
BEGIN
    IF NOT campus_api.can_create_event(p_user) THEN
        RETURN QUERY SELECT NULL::INT, 'forbidden'::TEXT;
    ELSIF event_start <= clock_timestamp() THEN
        RETURN QUERY SELECT NULL::INT, 'past'::TEXT;
    ELSE
        RETURN QUERY
        INSERT INTO public.events AS e (title, description, venue, starts_at, capacity, organizer_id)
        VALUES (p_title, p_description, p_venue, event_start, p_capacity, p_user)
        RETURNING e.event_id, 'ok'::TEXT;
    END IF;
END;
$$;

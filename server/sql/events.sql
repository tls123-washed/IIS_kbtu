-- Мероприятия и билеты. Запись на последнее место проверяется под блокировкой.
CREATE OR REPLACE FUNCTION campus_api.events_page(
    p_user INT, p_limit INT DEFAULT 30, p_after_time TIMESTAMPTZ DEFAULT NULL, p_after_id INT DEFAULT NULL
)
RETURNS TABLE (event_id INT, title VARCHAR, description VARCHAR, venue VARCHAR,
               starts_at TIMESTAMPTZ, available BIGINT, ticket_id UUID)
LANGUAGE sql STABLE AS $$
    SELECT e.event_id, e.title, e.description, e.venue, e.starts_at,
           GREATEST(e.capacity - (
               SELECT COUNT(*) FROM public.event_tickets t WHERE t.event_id = e.event_id
           ), 0),
           mine.ticket_id
    FROM public.events e LEFT JOIN public.event_tickets mine
        ON mine.event_id = e.event_id AND mine.user_id = p_user
    WHERE e.starts_at > now()
      AND (p_after_time IS NULL OR (e.starts_at, e.event_id) > (p_after_time, p_after_id))
    ORDER BY e.starts_at, e.event_id
    LIMIT LEAST(GREATEST(p_limit, 1), 51);
$$;

CREATE OR REPLACE FUNCTION campus_api.my_tickets(p_user INT)
RETURNS TABLE (ticket_id UUID, issued_at TIMESTAMPTZ, title VARCHAR, venue VARCHAR, starts_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT t.ticket_id, t.issued_at, e.title, e.venue, e.starts_at
    FROM public.event_tickets t JOIN public.events e USING (event_id)
    WHERE t.user_id = p_user
    ORDER BY e.starts_at DESC, e.event_id DESC;
$$;

CREATE OR REPLACE FUNCTION campus_api.issue_ticket(p_user INT, p_event INT)
RETURNS TABLE (ticket_id UUID, outcome TEXT)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    target public.events%ROWTYPE;
    existing UUID;
BEGIN
    SELECT e.* INTO target FROM public.events e WHERE e.event_id = p_event FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::UUID, 'missing'::TEXT;
        RETURN;
    END IF;

    SELECT t.ticket_id INTO existing FROM public.event_tickets t
    WHERE t.event_id = p_event AND t.user_id = p_user;
    IF existing IS NOT NULL THEN
        RETURN QUERY SELECT existing, 'ok'::TEXT;
    ELSIF target.starts_at <= clock_timestamp() THEN
        RETURN QUERY SELECT NULL::UUID, 'closed'::TEXT;
    ELSIF (SELECT COUNT(*) FROM public.event_tickets t WHERE t.event_id = p_event) >= target.capacity THEN
        RETURN QUERY SELECT NULL::UUID, 'full'::TEXT;
    ELSE
        RETURN QUERY
        INSERT INTO public.event_tickets AS t (event_id, user_id) VALUES (p_event, p_user)
        RETURNING t.ticket_id, 'ok'::TEXT;
    END IF;
END;
$$;

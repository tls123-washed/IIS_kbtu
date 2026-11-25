ALTER TABLE public.events ADD COLUMN cover_jpeg BYTEA
    CHECK (octet_length(cover_jpeg) <= 200000);
ALTER TABLE public.event_tickets ADD COLUMN checked_in_at TIMESTAMPTZ;

CREATE FUNCTION campus_api.is_site_moderator(p_user INT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.moderators WHERE user_id = p_user AND access_level = 2);
$$;

CREATE FUNCTION campus_api.can_check_in(p_user INT, p_organizer INT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT campus_api.is_site_moderator(p_user)
        OR COALESCE(p_user = p_organizer AND campus_api.can_create_event(p_user), FALSE);
$$;

CREATE FUNCTION campus_api.event_cards(
    p_user INT, p_archive BOOLEAN, p_limit INT, p_after_time TIMESTAMPTZ,
    p_after_id INT, p_event INT DEFAULT NULL
)
RETURNS TABLE (event_id INT, title VARCHAR, description VARCHAR, venue VARCHAR,
               starts_at TIMESTAMPTZ, available BIGINT, ticket_id UUID,
               capacity INT, registered BIGINT, checked_in BIGINT, has_cover BOOLEAN,
               started BOOLEAN, can_check_in BOOLEAN, checked_in_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    WITH page AS (
        SELECT e.event_id, e.title, e.description, e.venue, e.starts_at, e.capacity,
               e.organizer_id, e.cover_jpeg IS NOT NULL AS has_cover
        FROM public.events e
        WHERE (p_event IS NOT NULL AND e.event_id = p_event)
           OR (p_event IS NULL AND (e.starts_at <= now()) = p_archive
              AND (p_after_time IS NULL
                   OR (p_archive AND (e.starts_at, e.event_id) < (p_after_time, p_after_id))
                   OR (NOT p_archive AND (e.starts_at, e.event_id) > (p_after_time, p_after_id))))
        ORDER BY CASE WHEN p_archive THEN e.starts_at END DESC,
                 CASE WHEN p_archive THEN e.event_id END DESC, e.starts_at, e.event_id
        LIMIT LEAST(GREATEST(p_limit, 1), 51)
    )
    SELECT e.event_id, e.title, e.description, e.venue, e.starts_at,
           GREATEST(e.capacity - totals.registered, 0), mine.ticket_id,
           e.capacity, totals.registered, totals.checked_in, e.has_cover,
           e.starts_at <= now(), campus_api.can_check_in(p_user, e.organizer_id), mine.checked_in_at
    FROM page e
    LEFT JOIN public.event_tickets mine ON mine.event_id = e.event_id AND mine.user_id = p_user
    CROSS JOIN LATERAL (
        SELECT count(*) AS registered, count(checked_in_at) AS checked_in
        FROM public.event_tickets t WHERE t.event_id = e.event_id
    ) totals
    ORDER BY CASE WHEN p_archive THEN e.starts_at END DESC,
             CASE WHEN p_archive THEN e.event_id END DESC, e.starts_at, e.event_id;
$$;

CREATE FUNCTION campus_api.check_in_ticket(p_user INT, p_event INT, p_ticket UUID)
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    target public.events%ROWTYPE;
BEGIN
    SELECT e.* INTO target FROM public.events e WHERE e.event_id = p_event;
    IF NOT FOUND THEN RETURN 'missing'; END IF;
    IF NOT campus_api.can_check_in(p_user, target.organizer_id) THEN RETURN 'forbidden'; END IF;
    IF target.starts_at > clock_timestamp() THEN RETURN 'too_early'; END IF;
    UPDATE public.event_tickets t SET checked_in_at = clock_timestamp()
    WHERE t.event_id = p_event AND t.ticket_id = p_ticket AND t.checked_in_at IS NULL;
    IF FOUND THEN RETURN 'checked_in'; END IF;
    IF EXISTS (SELECT 1 FROM public.event_tickets t WHERE t.event_id = p_event AND t.ticket_id = p_ticket) THEN
        RETURN 'already_checked_in';
    END IF;
    RETURN 'missing';
END;
$$;

CREATE FUNCTION campus_api.search_catalog(p_term TEXT)
RETURNS JSONB LANGUAGE sql STABLE AS $$
    WITH pattern AS (
        SELECT '%' || replace(replace(replace(p_term, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' AS text
    )
    SELECT jsonb_build_object('communities', COALESCE((
        SELECT jsonb_agg(row) FROM (
            SELECT c.community_id, c.name, c.description FROM public.communities c, pattern p
            WHERE c.name ILIKE p.text OR c.description ILIKE p.text ORDER BY c.name, c.community_id LIMIT 12
        ) row
    ), '[]'), 'events', COALESCE((
        SELECT jsonb_agg(row) FROM (
            SELECT e.event_id, e.title, e.venue, e.starts_at FROM public.events e, pattern p
            WHERE e.title ILIKE p.text OR e.description ILIKE p.text OR e.venue ILIKE p.text
            ORDER BY e.starts_at <= now(), e.starts_at DESC, e.event_id DESC LIMIT 12
        ) row
    ), '[]'));
$$;

-- Сериализуем выход администраторов одного сообщества на одной строке сообщества.
CREATE OR REPLACE PROCEDURE campus_api.set_membership(p_user INT, p_community INT, p_enabled BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_enabled THEN
        INSERT INTO public.community_members (user_id, community_id) VALUES (p_user, p_community)
        ON CONFLICT DO NOTHING;
    ELSE
        PERFORM 1 FROM public.communities WHERE community_id = p_community FOR UPDATE;
        IF EXISTS (SELECT 1 FROM public.community_members
                   WHERE community_id = p_community AND user_id = p_user AND role = 'admin')
           AND NOT EXISTS (SELECT 1 FROM public.community_members
                           WHERE community_id = p_community AND user_id <> p_user AND role = 'admin') THEN
            RAISE EXCEPTION 'last_community_admin' USING ERRCODE = 'CT001';
        END IF;
        DELETE FROM public.community_members WHERE user_id = p_user AND community_id = p_community;
    END IF;
END;
$$;

CREATE VIEW campus_api.live_summary AS
SELECT now() AS updated_at,
    (SELECT count(*) FROM public.users) AS accounts,
    (SELECT count(*) FROM public.communities) AS communities,
    (SELECT count(*) FROM public.posts WHERE parent_post_id IS NULL) AS threads,
    (SELECT count(*) FROM public.posts WHERE parent_post_id IS NOT NULL) AS replies,
    (SELECT count(*) FROM public.likes) AS likes,
    (SELECT count(*) FROM public.follows) AS follows,
    (SELECT count(*) FROM public.community_members) AS memberships,
    (SELECT count(*) FROM public.events WHERE starts_at > now()) AS upcoming,
    (SELECT count(*) FROM public.events WHERE starts_at <= now()) AS past,
    (SELECT count(*) FROM public.event_tickets) AS tickets,
    (SELECT count(checked_in_at) FROM public.event_tickets) AS check_ins;

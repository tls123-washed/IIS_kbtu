-- Campus Threads: schema version 11, PostgreSQL 18.
-- Restore into a NEW EMPTY database. No user data included.

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: campus_api; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA campus_api;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: post_card; Type: TYPE; Schema: campus_api; Owner: -
--

CREATE TYPE campus_api.post_card AS (
	post_id integer,
	parent_post_id integer,
	author text,
	content text,
	community text,
	created_at timestamp with time zone,
	like_count bigint,
	reply_count bigint,
	is_anonymous boolean,
	community_id integer,
	author_id integer,
	full_name text,
	mine boolean,
	liked boolean
);


--
-- Name: begin_microsoft_profile(text, uuid, uuid, text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.begin_microsoft_profile(p_hash text, p_tenant uuid, p_object uuid, p_email text) RETURNS boolean
    LANGUAGE sql
    AS $$
    WITH pending AS (
        INSERT INTO public.microsoft_pending (browser_hash, tenant_id, object_id, email)
        SELECT p_hash, p_tenant, p_object, p_email
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = p_email)
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM pending);
$$;


--
-- Name: can_check_in(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.can_check_in(p_user integer, p_organizer integer) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    SELECT campus_api.is_site_moderator(p_user)
        OR COALESCE(p_user = p_organizer AND campus_api.can_create_event(p_user), FALSE);
$$;


--
-- Name: can_create_event(integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.can_create_event(p_user integer) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    SELECT EXISTS (SELECT 1 FROM public.event_organizers WHERE user_id = p_user)
        OR EXISTS (
            SELECT 1 FROM public.moderators
            WHERE user_id = p_user AND access_level = 2
        );
$$;


--
-- Name: change_moderator(text, boolean, text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.change_moderator(p_username text, p_enabled boolean, p_community text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    target_user INT;
    target_community INT;
    member_role TEXT;
BEGIN
    SELECT u.user_id INTO target_user FROM public.users u WHERE u.username = p_username;
    IF NOT FOUND THEN RETURN 'user_missing'; END IF;

    IF p_community IS NULL THEN
        IF p_enabled THEN
            INSERT INTO public.moderators AS m (user_id, access_level)
            VALUES (target_user, 2)
            ON CONFLICT (user_id) DO UPDATE SET access_level = 2, assigned_at = CURRENT_DATE
            WHERE m.access_level <> 2;
        ELSE
            DELETE FROM public.moderators WHERE user_id = target_user AND access_level = 2;
        END IF;
        RETURN 'ok';
    END IF;

    SELECT c.community_id INTO target_community FROM public.communities c WHERE c.name = p_community;
    IF NOT FOUND THEN RETURN 'community_missing'; END IF;

    SELECT m.role INTO member_role FROM public.community_members m
    WHERE m.user_id = target_user AND m.community_id = target_community FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_member'; END IF;
    IF member_role = 'admin' THEN RETURN 'admin'; END IF;
    UPDATE public.community_members
    SET role = CASE WHEN p_enabled THEN 'moderator' ELSE 'member' END
    WHERE user_id = target_user AND community_id = target_community;
    RETURN 'ok';
END;
$$;


--
-- Name: check_in_ticket(integer, integer, uuid); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.check_in_ticket(p_user integer, p_event integer, p_ticket uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: community_posts(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.community_posts(p_viewer integer, p_community integer) RETURNS SETOF campus_api.post_card
    LANGUAGE sql STABLE
    AS $$
    SELECT card.*
    FROM public.posts p
    CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, p.post_id) card
    WHERE p.community_id = p_community AND p.parent_post_id IS NULL
    ORDER BY p.created_at DESC, p.post_id DESC LIMIT 30;
$$;


--
-- Name: create_community(integer, text, text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.create_community(p_user integer, p_name text, p_description text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    username character varying(30) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255),
    first_name character varying(50) NOT NULL,
    last_name character varying(50) NOT NULL,
    bio character varying(160),
    user_type character varying(10) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    email_verified_at timestamp with time zone,
    domain_registration boolean DEFAULT false NOT NULL,
    avatar_jpeg bytea,
    avatar_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT domain_registration_kbtu_email CHECK (((NOT domain_registration) OR ((email)::text ~ '^[a-z0-9_+%-]+([.][a-z0-9_+%-]+)*@kbtu[.]kz$'::text))),
    CONSTRAINT domain_registration_password CHECK (((NOT domain_registration) OR (password_hash IS NOT NULL))),
    CONSTRAINT users_avatar_jpeg_check CHECK ((octet_length(avatar_jpeg) <= 200000)),
    CONSTRAINT users_email_check CHECK (((email)::text ~~ '%_@_%._%'::text)),
    CONSTRAINT users_user_type_check CHECK (((user_type)::text = ANY ((ARRAY['student'::character varying, 'teacher'::character varying])::text[]))),
    CONSTRAINT users_username_check CHECK (((username)::text ~ '^[a-z0-9_.]{3,30}$'::text)),
    CONSTRAINT verified_kbtu_email CHECK (((email_verified_at IS NULL) OR ((email)::text ~ '^[a-z0-9_+%-]+([.][a-z0-9_+%-]+)*@kbtu[.]kz$'::text)))
);


--
-- Name: account_summary; Type: VIEW; Schema: campus_api; Owner: -
--

CREATE VIEW campus_api.account_summary AS
 SELECT user_id,
    username,
    first_name,
    last_name,
    user_type,
    (((first_name)::text || ' '::text) || (last_name)::text) AS full_name
   FROM public.users u;


--
-- Name: create_domain_student(text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.create_domain_student(p_username text, p_email text, p_password_hash text, p_first text, p_last text, p_year integer, p_faculty integer) RETURNS SETOF campus_api.account_summary
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: create_event(integer, text, text, text, timestamp without time zone, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.create_event(p_user integer, p_title text, p_description text, p_venue text, p_start_local timestamp without time zone, p_capacity integer) RETURNS TABLE(event_id integer, outcome text)
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: create_microsoft_student(text, uuid, text, text, text, integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.create_microsoft_student(p_hash text, p_tenant uuid, p_username text, p_first text, p_last text, p_year integer, p_faculty integer) RETURNS SETOF campus_api.account_summary
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: create_session(text, integer); Type: PROCEDURE; Schema: campus_api; Owner: -
--

CREATE PROCEDURE campus_api.create_session(IN p_hash text, IN p_user integer)
    LANGUAGE sql
    AS $$
    INSERT INTO public.sessions (token_hash, user_id) VALUES (p_hash, p_user);
$$;


--
-- Name: create_student(text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.create_student(p_username text, p_email text, p_password_hash text, p_first text, p_last text, p_year integer, p_faculty integer) RETURNS SETOF campus_api.account_summary
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: delete_post(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.delete_post(p_user integer, p_post integer) RETURNS boolean
    LANGUAGE sql
    AS $$
    WITH deleted AS (
        DELETE FROM public.posts p USING campus_api.post_moderation(p_user) rights
        WHERE p.post_id = p_post
          AND (p.author_id = p_user OR rights.site_wide OR p.community_id = ANY(rights.community_ids))
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;


--
-- Name: delete_session(text); Type: PROCEDURE; Schema: campus_api; Owner: -
--

CREATE PROCEDURE campus_api.delete_session(IN p_hash text)
    LANGUAGE sql
    AS $$
    DELETE FROM public.sessions WHERE token_hash = p_hash::CHAR(64);
$$;


--
-- Name: event_cards(integer, boolean, integer, timestamp with time zone, integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.event_cards(p_user integer, p_archive boolean, p_limit integer, p_after_time timestamp with time zone, p_after_id integer, p_event integer DEFAULT NULL::integer) RETURNS TABLE(event_id integer, title character varying, description character varying, venue character varying, starts_at timestamp with time zone, available bigint, ticket_id uuid, capacity integer, registered bigint, checked_in bigint, has_cover boolean, started boolean, can_check_in boolean, checked_in_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: events_page(integer, integer, timestamp with time zone, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.events_page(p_user integer, p_limit integer DEFAULT 30, p_after_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id integer DEFAULT NULL::integer) RETURNS TABLE(event_id integer, title character varying, description character varying, venue character varying, starts_at timestamp with time zone, available bigint, ticket_id uuid)
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: faculties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faculties (
    faculty_id integer NOT NULL,
    name character varying(100) NOT NULL,
    short_name character varying(10) NOT NULL
);


--
-- Name: faculties(); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.faculties() RETURNS SETOF public.faculties
    LANGUAGE sql STABLE
    AS $$
    SELECT * FROM public.faculties ORDER BY faculty_id;
$$;


--
-- Name: feed_page(integer, boolean, integer, timestamp with time zone, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.feed_page(p_viewer integer, p_following boolean DEFAULT false, p_limit integer DEFAULT 30, p_after_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id integer DEFAULT NULL::integer) RETURNS SETOF campus_api.post_card
    LANGUAGE sql STABLE
    AS $$
    SELECT card.*
    FROM (
        SELECT p.post_id, p.created_at
        FROM public.posts p
        WHERE p.parent_post_id IS NULL
          AND (NOT p_following OR EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = p_viewer AND f.followee_id = p.author_id
          ))
          AND (p_after_time IS NULL OR (p.created_at, p.post_id)
              < (p_after_time AT TIME ZONE 'UTC', p_after_id))
        ORDER BY p.created_at DESC, p.post_id DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 51)
    ) page
    CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, page.post_id) card
    ORDER BY page.created_at DESC, page.post_id DESC;
$$;


--
-- Name: grant_event_organizer(text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.grant_event_organizer(p_username text) RETURNS boolean
    LANGUAGE sql
    AS $$
    WITH target AS (
        SELECT user_id FROM public.users WHERE username = p_username
    ), granted AS (
        INSERT INTO public.event_organizers (user_id)
        SELECT user_id FROM target ON CONFLICT DO NOTHING
    )
    SELECT EXISTS (SELECT 1 FROM target);
$$;


--
-- Name: is_site_moderator(integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.is_site_moderator(p_user integer) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    SELECT EXISTS (SELECT 1 FROM public.moderators WHERE user_id = p_user AND access_level = 2);
$$;


--
-- Name: issue_ticket(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.issue_ticket(p_user integer, p_event integer) RETURNS TABLE(ticket_id uuid, outcome text)
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: link_microsoft(uuid, uuid, integer, text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.link_microsoft(p_tenant uuid, p_object uuid, p_user integer, p_email text) RETURNS boolean
    LANGUAGE sql
    AS $$
    WITH linked AS (
        INSERT INTO public.microsoft_identities (tenant_id, object_id, user_id)
        SELECT p_tenant, p_object, u.user_id FROM public.users u
        WHERE u.user_id = p_user AND u.email = p_email AND u.email_verified_at IS NOT NULL
        ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM linked);
$$;


--
-- Name: list_communities(integer, boolean, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.list_communities(p_viewer integer, p_joined boolean DEFAULT false, p_community integer DEFAULT NULL::integer) RETURNS TABLE(community_id integer, name character varying, description character varying, members bigint, joined boolean)
    LANGUAGE sql STABLE
    AS $$
    SELECT c.community_id, c.name, c.description, COUNT(m.user_id),
           COALESCE(BOOL_OR(m.user_id = p_viewer), FALSE)
    FROM public.communities c LEFT JOIN public.community_members m USING (community_id)
    WHERE p_community IS NULL OR c.community_id = p_community
    GROUP BY c.community_id
    HAVING NOT p_joined OR BOOL_OR(m.user_id = p_viewer)
    ORDER BY COUNT(m.user_id) DESC, c.name;
$$;


--
-- Name: login_account(text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.login_account(p_username text) RETURNS TABLE(account campus_api.account_summary, password_hash text)
    LANGUAGE sql STABLE
    AS $$
    SELECT a, u.password_hash::TEXT
    FROM public.users u JOIN campus_api.account_summary a USING (user_id)
    WHERE u.username = p_username AND u.email_verified_at IS NOT NULL;
$$;


--
-- Name: login_account(text, boolean); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.login_account(p_username text, p_allow_domain boolean) RETURNS TABLE(account campus_api.account_summary, password_hash text)
    LANGUAGE sql STABLE
    AS $$
    SELECT a, u.password_hash::TEXT
    FROM public.users u JOIN campus_api.account_summary a USING (user_id)
    WHERE u.username = p_username
      AND (u.email_verified_at IS NOT NULL OR (p_allow_domain AND u.domain_registration));
$$;


--
-- Name: microsoft_profile_email(text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.microsoft_profile_email(p_hash text) RETURNS TABLE(email character varying)
    LANGUAGE sql STABLE
    AS $$
    SELECT p.email FROM public.microsoft_pending p
    WHERE p.browser_hash = p_hash::CHAR(64) AND p.expires_at > now();
$$;


--
-- Name: microsoft_user(uuid, uuid); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.microsoft_user(p_tenant uuid, p_object uuid) RETURNS SETOF campus_api.account_summary
    LANGUAGE sql STABLE
    AS $$
    SELECT a.* FROM campus_api.account_summary a JOIN public.microsoft_identities m USING (user_id)
    WHERE m.tenant_id = p_tenant AND m.object_id = p_object;
$$;


--
-- Name: my_tickets(integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.my_tickets(p_user integer) RETURNS TABLE(ticket_id uuid, issued_at timestamp with time zone, title character varying, venue character varying, starts_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
    SELECT t.ticket_id, t.issued_at, e.title, e.venue, e.starts_at
    FROM public.event_tickets t JOIN public.events e USING (event_id)
    WHERE t.user_id = p_user
    ORDER BY e.starts_at DESC, e.event_id DESC;
$$;


--
-- Name: post_card_for(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.post_card_for(p_viewer integer, p_post integer) RETURNS SETOF campus_api.post_card
    LANGUAGE sql STABLE
    AS $$
    SELECT d.post_id, d.parent_post_id, d.author, d.content::TEXT, d.community::TEXT,
           d.created_at AT TIME ZONE 'UTC', d.like_count, d.reply_count,
           p.is_anonymous, p.community_id,
           CASE WHEN NOT p.is_anonymous THEN p.author_id END,
           CASE WHEN NOT p.is_anonymous THEN u.first_name || ' ' || u.last_name END,
           p.author_id = p_viewer,
           EXISTS (SELECT 1 FROM public.likes l WHERE l.post_id = p_post AND l.user_id = p_viewer)
    FROM public.v_post_details d
    JOIN public.posts p USING (post_id)
    JOIN public.users u ON u.user_id = p.author_id
    WHERE d.post_id = p_post;
$$;


--
-- Name: post_moderation(integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.post_moderation(p_user integer) RETURNS TABLE(site_wide boolean, community_ids integer[])
    LANGUAGE sql STABLE
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.moderators WHERE user_id = p_user AND access_level = 2
    ), ARRAY(
        SELECT community_id FROM public.community_members
        WHERE user_id = p_user AND role IN ('admin', 'moderator')
    );
$$;


--
-- Name: profile_posts(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.profile_posts(p_viewer integer, p_user integer) RETURNS SETOF campus_api.post_card
    LANGUAGE sql STABLE
    AS $$
    SELECT card.*
    FROM public.posts p
    CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, p.post_id) card
    WHERE p.author_id = p_user AND p.parent_post_id IS NULL
      AND (NOT p.is_anonymous OR p.author_id = p_viewer)
    ORDER BY p.created_at DESC, p.post_id DESC LIMIT 20;
$$;


--
-- Name: publish_post(integer, integer, integer, text, boolean, text[]); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.publish_post(p_user integer, p_community integer, p_parent integer, p_content text, p_anonymous boolean, p_tags text[]) RETURNS TABLE(post_id integer, community_id integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    new_post public.posts%ROWTYPE;
BEGIN
    IF p_community IS NOT NULL THEN
        PERFORM 1 FROM public.community_members m
        WHERE m.user_id = p_user AND m.community_id = p_community FOR KEY SHARE;
        IF NOT FOUND THEN RETURN; END IF;
    END IF;
    INSERT INTO public.posts (author_id, community_id, parent_post_id, content, is_anonymous)
    VALUES (p_user, p_community, p_parent, p_content, p_anonymous)
    RETURNING * INTO new_post;

    INSERT INTO public.hashtags (tag)
    SELECT DISTINCT tag FROM unnest(p_tags) AS tags(tag) ORDER BY tag
    ON CONFLICT (tag) DO NOTHING;
    INSERT INTO public.post_hashtags (post_id, hashtag_id)
    SELECT new_post.post_id, h.hashtag_id FROM public.hashtags h WHERE h.tag = ANY(p_tags);
    RETURN QUERY SELECT new_post.post_id, new_post.community_id;
END;
$$;


--
-- Name: read_profile(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.read_profile(p_viewer integer, p_user integer) RETURNS TABLE(user_id integer, username character varying, full_name text, user_type character varying, faculty character varying, year_of_study smallint, "position" character varying, is_mentor boolean, scholarship_type character varying, followers bigint, following bigint, posts bigint, bio character varying, moderator_level smallint, i_follow boolean)
    LANGUAGE sql STABLE
    AS $$
    SELECT v.user_id, v.username, v.full_name, v.user_type, v.faculty,
           v.year_of_study, v.position, v.is_mentor, v.scholarship_type, v.followers, v.following,
           (SELECT COUNT(*) FROM public.posts p WHERE p.author_id = p_user
               AND (NOT p.is_anonymous OR p_user = p_viewer)),
           u.bio, mo.access_level,
           EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = p_viewer AND f.followee_id = p_user)
    FROM public.v_user_profiles v
    JOIN public.users u USING (user_id)
    LEFT JOIN public.moderators mo USING (user_id)
    WHERE v.user_id = p_user;
$$;


--
-- Name: read_thread(integer, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.read_thread(p_viewer integer, p_post integer) RETURNS TABLE(depth integer, card campus_api.post_card)
    LANGUAGE sql STABLE
    AS $$
    WITH RECURSIVE tree AS (
        SELECT post_id, 0 AS depth, ARRAY[post_id] AS path
        FROM public.posts WHERE post_id = p_post
      UNION ALL
        SELECT p.post_id, t.depth + 1, t.path || p.post_id
        FROM public.posts p JOIN tree t ON p.parent_post_id = t.post_id
    )
    SELECT t.depth, card
    FROM tree t CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, t.post_id) card
    ORDER BY t.path LIMIT 200;
$$;


--
-- Name: search(integer, text, text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.search(p_viewer integer, p_term text, p_tag text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    pattern TEXT;
    cards JSONB;
    people JSONB;
BEGIN
    IF p_tag <> '' THEN
        SELECT jsonb_agg(card ORDER BY card.created_at DESC, card.post_id DESC) INTO cards
        FROM (
            SELECT c.*
            FROM public.hashtags h JOIN public.post_hashtags ph USING (hashtag_id)
            CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, ph.post_id) c
            WHERE h.tag = p_tag ORDER BY c.created_at DESC, c.post_id DESC LIMIT 30
        ) card;
        RETURN jsonb_build_object('posts', COALESCE(cards, '[]'));
    END IF;

    IF p_term <> '' THEN
        -- В поиске проценты и подчёркивания считаются обычным текстом.
        pattern := '%' || replace(replace(replace(p_term, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
        SELECT jsonb_agg(person ORDER BY person.followers DESC, person.user_id) INTO people
        FROM (
            SELECT v.user_id, v.username, v.full_name, v.user_type, v.faculty, v.followers
            FROM public.v_user_profiles v WHERE v.username ILIKE pattern OR v.full_name ILIKE pattern
            ORDER BY v.followers DESC, v.user_id LIMIT 8
        ) person;
        SELECT jsonb_agg(card ORDER BY card.like_count DESC, card.post_id DESC) INTO cards
        FROM (
            SELECT c.* FROM public.posts p
            CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, p.post_id) c
            WHERE p.content ILIKE pattern ORDER BY c.like_count DESC, c.post_id DESC LIMIT 15
        ) card;
        RETURN jsonb_build_object('users', COALESCE(people, '[]'), 'posts', COALESCE(cards, '[]'));
    END IF;

    RETURN jsonb_build_object(
        'tags', COALESCE((
            SELECT jsonb_agg(t ORDER BY t.uses DESC, t.tag) FROM (
                SELECT h.tag, COUNT(*) AS uses
                FROM public.hashtags h JOIN public.post_hashtags ph USING (hashtag_id)
                GROUP BY h.tag ORDER BY uses DESC, h.tag LIMIT 12
            ) t
        ), '[]'),
        'recommendations', COALESCE((
            SELECT jsonb_agg(person ORDER BY person.mutual DESC, person.user_id) FROM (
                SELECT v.user_id, v.username, v.full_name, v.user_type, v.faculty, v.followers, COUNT(*) AS mutual
                FROM public.follows f1 JOIN public.follows f2 ON f2.follower_id = f1.followee_id
                JOIN public.v_user_profiles v ON v.user_id = f2.followee_id
                WHERE f1.follower_id = p_viewer AND f2.followee_id <> p_viewer
                  AND NOT EXISTS (
                      SELECT 1 FROM public.follows f WHERE f.follower_id = p_viewer AND f.followee_id = f2.followee_id
                  )
                GROUP BY v.user_id, v.username, v.full_name, v.user_type, v.faculty, v.followers
                ORDER BY mutual DESC, v.user_id LIMIT 5
            ) person
        ), '[]')
    );
END;
$$;


--
-- Name: search_catalog(text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.search_catalog(p_term text) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: session_user(text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api."session_user"(p_hash text) RETURNS SETOF campus_api.account_summary
    LANGUAGE sql STABLE
    AS $$
    SELECT a.* FROM public.sessions s
    JOIN public.users u USING (user_id)
    JOIN campus_api.account_summary a USING (user_id)
    WHERE s.token_hash = p_hash::CHAR(64) AND s.expires_at > now() AND u.email_verified_at IS NOT NULL;
$$;


--
-- Name: session_user(text, boolean); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api."session_user"(p_hash text, p_allow_domain boolean) RETURNS SETOF campus_api.account_summary
    LANGUAGE sql STABLE
    AS $$
    SELECT a.* FROM public.sessions s
    JOIN public.users u USING (user_id)
    JOIN campus_api.account_summary a USING (user_id)
    WHERE s.token_hash = p_hash::CHAR(64) AND s.expires_at > now()
      AND (u.email_verified_at IS NOT NULL OR (p_allow_domain AND u.domain_registration));
$$;


--
-- Name: set_follow(integer, integer, boolean); Type: PROCEDURE; Schema: campus_api; Owner: -
--

CREATE PROCEDURE campus_api.set_follow(IN p_user integer, IN p_target integer, IN p_enabled boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF p_enabled THEN
        INSERT INTO public.follows (follower_id, followee_id) VALUES (p_user, p_target)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.follows WHERE follower_id = p_user AND followee_id = p_target;
    END IF;
END;
$$;


--
-- Name: set_like(integer, integer, boolean); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.set_like(p_user integer, p_post integer, p_enabled boolean) RETURNS TABLE(like_count bigint, liked boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF p_enabled THEN
        INSERT INTO public.likes (user_id, post_id) VALUES (p_user, p_post) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.likes WHERE user_id = p_user AND post_id = p_post;
    END IF;
    RETURN QUERY SELECT card.like_count, card.liked FROM campus_api.post_card_for(p_user, p_post) card;
END;
$$;


--
-- Name: set_membership(integer, integer, boolean); Type: PROCEDURE; Schema: campus_api; Owner: -
--

CREATE PROCEDURE campus_api.set_membership(IN p_user integer, IN p_community integer, IN p_enabled boolean)
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: store_microsoft_flow(text, jsonb, integer); Type: PROCEDURE; Schema: campus_api; Owner: -
--

CREATE PROCEDURE campus_api.store_microsoft_flow(IN p_hash text, IN p_flow jsonb, IN p_user integer)
    LANGUAGE sql
    AS $$
    DELETE FROM public.microsoft_flows WHERE expires_at <= now();
    DELETE FROM public.microsoft_pending WHERE expires_at <= now();
    INSERT INTO public.microsoft_flows (browser_hash, flow, link_user_id) VALUES (p_hash, p_flow, p_user);
$$;


--
-- Name: take_microsoft_flow(text, text); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.take_microsoft_flow(p_hash text, p_state text) RETURNS TABLE(flow jsonb, link_user_id integer)
    LANGUAGE sql
    AS $$
    DELETE FROM public.microsoft_flows f
    WHERE f.browser_hash = p_hash::CHAR(64) AND f.expires_at > now() AND f.flow->>'state' = p_state
    RETURNING f.flow, f.link_user_id;
$$;


--
-- Name: take_rate_limit(text, interval, integer); Type: FUNCTION; Schema: campus_api; Owner: -
--

CREATE FUNCTION campus_api.take_rate_limit(p_key text, p_window interval, p_max integer) RETURNS boolean
    LANGUAGE sql
    AS $$
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


--
-- Name: update_bio(integer, text); Type: PROCEDURE; Schema: campus_api; Owner: -
--

CREATE PROCEDURE campus_api.update_bio(IN p_user integer, IN p_bio text)
    LANGUAGE sql
    AS $$
    UPDATE public.users SET bio = NULLIF(p_bio, '') WHERE user_id = p_user;
$$;


--
-- Name: check_user_subtype(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_user_subtype() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    actual_type VARCHAR;
BEGIN
    SELECT user_type INTO actual_type FROM users WHERE user_id = NEW.user_id;
    IF actual_type IS DISTINCT FROM TG_ARGV[0] THEN
        RAISE EXCEPTION 'Пользователь % имеет тип %, а не %', NEW.user_id, actual_type, TG_ARGV[0];
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: get_feed(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_feed(p_user_id integer, p_limit integer DEFAULT 20) RETURNS TABLE(post_id integer, author text, content character varying, community character varying, created_at timestamp without time zone, like_count bigint, reply_count bigint)
    LANGUAGE sql STABLE
    AS $$
    SELECT d.post_id, d.author, d.content, d.community, d.created_at, d.like_count, d.reply_count
    FROM v_post_details d
    JOIN posts p ON p.post_id = d.post_id
    WHERE p.parent_post_id IS NULL
      AND p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = p_user_id)
    ORDER BY d.created_at DESC
    LIMIT p_limit;
$$;


--
-- Name: inherit_reply_community(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inherit_reply_community() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.parent_post_id IS NOT NULL THEN
        SELECT community_id INTO NEW.community_id FROM posts WHERE post_id = NEW.parent_post_id;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: communities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communities (
    community_id integer NOT NULL,
    name character varying(60) NOT NULL,
    description character varying(300),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: community_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_members (
    user_id integer NOT NULL,
    community_id integer NOT NULL,
    role character varying(10) DEFAULT 'member'::character varying NOT NULL,
    joined_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_members_role_check CHECK (((role)::text = ANY ((ARRAY['member'::character varying, 'moderator'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: event_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_tickets (
    ticket_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id integer NOT NULL,
    user_id integer NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_in_at timestamp with time zone
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    event_id integer NOT NULL,
    title character varying(100) NOT NULL,
    description character varying(600) DEFAULT ''::character varying NOT NULL,
    venue character varying(120) NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    capacity integer NOT NULL,
    organizer_id integer,
    cover_jpeg bytea,
    CONSTRAINT events_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT events_cover_jpeg_check CHECK ((octet_length(cover_jpeg) <= 200000)),
    CONSTRAINT events_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT events_venue_check CHECK ((length(TRIM(BOTH FROM venue)) > 0))
);


--
-- Name: follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follows (
    follower_id integer NOT NULL,
    followee_id integer NOT NULL,
    followed_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT follows_check CHECK ((follower_id <> followee_id))
);


--
-- Name: likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.likes (
    user_id integer NOT NULL,
    post_id integer NOT NULL,
    liked_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    post_id integer NOT NULL,
    author_id integer NOT NULL,
    community_id integer,
    parent_post_id integer,
    content character varying(500) NOT NULL,
    is_anonymous boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT posts_check CHECK (((parent_post_id IS NULL) OR (parent_post_id <> post_id))),
    CONSTRAINT posts_content_check CHECK ((length(TRIM(BOTH FROM content)) > 0))
);


--
-- Name: live_summary; Type: VIEW; Schema: campus_api; Owner: -
--

CREATE VIEW campus_api.live_summary AS
 SELECT now() AS updated_at,
    ( SELECT count(*) AS count
           FROM public.users) AS accounts,
    ( SELECT count(*) AS count
           FROM public.communities) AS communities,
    ( SELECT count(*) AS count
           FROM public.posts
          WHERE (posts.parent_post_id IS NULL)) AS threads,
    ( SELECT count(*) AS count
           FROM public.posts
          WHERE (posts.parent_post_id IS NOT NULL)) AS replies,
    ( SELECT count(*) AS count
           FROM public.likes) AS likes,
    ( SELECT count(*) AS count
           FROM public.follows) AS follows,
    ( SELECT count(*) AS count
           FROM public.community_members) AS memberships,
    ( SELECT count(*) AS count
           FROM public.events
          WHERE (events.starts_at > now())) AS upcoming,
    ( SELECT count(*) AS count
           FROM public.events
          WHERE (events.starts_at <= now())) AS past,
    ( SELECT count(*) AS count
           FROM public.event_tickets) AS tickets,
    ( SELECT count(event_tickets.checked_in_at) AS count
           FROM public.event_tickets) AS check_ins;


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    post_id integer NOT NULL,
    attachment_no smallint NOT NULL,
    file_url character varying(300) NOT NULL,
    file_type character varying(10) NOT NULL,
    CONSTRAINT attachments_attachment_no_check CHECK (((attachment_no >= 1) AND (attachment_no <= 4))),
    CONSTRAINT attachments_file_type_check CHECK (((file_type)::text = ANY ((ARRAY['image'::character varying, 'video'::character varying, 'file'::character varying])::text[])))
);


--
-- Name: auth_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_limits (
    rate_key character(64) NOT NULL,
    hits integer DEFAULT 1 NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: campus_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campus_migrations (
    version integer NOT NULL
);


--
-- Name: communities_community_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.communities_community_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: communities_community_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.communities_community_id_seq OWNED BY public.communities.community_id;


--
-- Name: event_organizers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_organizers (
    user_id integer NOT NULL
);


--
-- Name: events_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.events ALTER COLUMN event_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.events_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: faculties_faculty_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.faculties_faculty_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: faculties_faculty_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.faculties_faculty_id_seq OWNED BY public.faculties.faculty_id;


--
-- Name: hashtags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hashtags (
    hashtag_id integer NOT NULL,
    tag character varying(50) NOT NULL,
    CONSTRAINT hashtags_tag_check CHECK (((tag)::text ~ '^[a-zа-яё0-9_]+$'::text))
);


--
-- Name: hashtags_hashtag_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hashtags_hashtag_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hashtags_hashtag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hashtags_hashtag_id_seq OWNED BY public.hashtags.hashtag_id;


--
-- Name: mentors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mentors (
    user_id integer NOT NULL,
    subject character varying(60) NOT NULL,
    mentor_since date DEFAULT CURRENT_DATE NOT NULL
);


--
-- Name: microsoft_flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.microsoft_flows (
    browser_hash character(64) NOT NULL,
    flow jsonb NOT NULL,
    link_user_id integer,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL
);


--
-- Name: microsoft_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.microsoft_identities (
    tenant_id uuid NOT NULL,
    object_id uuid NOT NULL,
    user_id integer NOT NULL
);


--
-- Name: microsoft_pending; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.microsoft_pending (
    browser_hash character(64) NOT NULL,
    tenant_id uuid NOT NULL,
    object_id uuid NOT NULL,
    email character varying(100) NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL
);


--
-- Name: moderators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderators (
    user_id integer NOT NULL,
    access_level smallint DEFAULT 1 NOT NULL,
    assigned_at date DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT moderators_access_level_check CHECK ((access_level = ANY (ARRAY[1, 2])))
);


--
-- Name: post_hashtags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_hashtags (
    post_id integer NOT NULL,
    hashtag_id integer NOT NULL
);


--
-- Name: posts_post_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.posts_post_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: posts_post_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.posts_post_id_seq OWNED BY public.posts.post_id;


--
-- Name: scholarship_holders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scholarship_holders (
    user_id integer NOT NULL,
    scholarship_type character varying(20) NOT NULL,
    monthly_amount numeric(9,2) NOT NULL,
    CONSTRAINT scholarship_holders_monthly_amount_check CHECK ((monthly_amount > (0)::numeric)),
    CONSTRAINT scholarship_holders_scholarship_type_check CHECK (((scholarship_type)::text = ANY ((ARRAY['state'::character varying, 'university'::character varying, 'presidential'::character varying, 'corporate'::character varying])::text[])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token_hash character(64) NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    user_id integer NOT NULL,
    student_number character varying(12) NOT NULL,
    year_of_study smallint NOT NULL,
    faculty_id integer NOT NULL,
    CONSTRAINT students_year_of_study_check CHECK (((year_of_study >= 1) AND (year_of_study <= 6)))
);


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    user_id integer NOT NULL,
    "position" character varying(50) NOT NULL,
    faculty_id integer NOT NULL
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: v_post_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_post_details AS
 SELECT p.post_id,
    p.parent_post_id,
        CASE
            WHEN p.is_anonymous THEN 'Аноним'::character varying
            ELSE u.username
        END AS author,
    p.content,
    c.name AS community,
    p.created_at,
    ( SELECT count(*) AS count
           FROM public.likes l
          WHERE (l.post_id = p.post_id)) AS like_count,
    ( SELECT count(*) AS count
           FROM public.posts r
          WHERE (r.parent_post_id = p.post_id)) AS reply_count
   FROM ((public.posts p
     JOIN public.users u ON ((u.user_id = p.author_id)))
     LEFT JOIN public.communities c ON ((c.community_id = p.community_id)));


--
-- Name: v_user_profiles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_profiles AS
 SELECT u.user_id,
    u.username,
    (((u.first_name)::text || ' '::text) || (u.last_name)::text) AS full_name,
    u.user_type,
    f.short_name AS faculty,
    s.year_of_study,
    t."position",
    (m.user_id IS NOT NULL) AS is_mentor,
    sh.scholarship_type,
    ( SELECT count(*) AS count
           FROM public.follows
          WHERE (follows.followee_id = u.user_id)) AS followers,
    ( SELECT count(*) AS count
           FROM public.follows
          WHERE (follows.follower_id = u.user_id)) AS following,
    ( SELECT count(*) AS count
           FROM public.posts
          WHERE (posts.author_id = u.user_id)) AS posts
   FROM (((((public.users u
     LEFT JOIN public.students s ON ((s.user_id = u.user_id)))
     LEFT JOIN public.teachers t ON ((t.user_id = u.user_id)))
     LEFT JOIN public.mentors m ON ((m.user_id = u.user_id)))
     LEFT JOIN public.scholarship_holders sh ON ((sh.user_id = u.user_id)))
     LEFT JOIN public.faculties f ON ((f.faculty_id = COALESCE(s.faculty_id, t.faculty_id))));


--
-- Name: communities community_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities ALTER COLUMN community_id SET DEFAULT nextval('public.communities_community_id_seq'::regclass);


--
-- Name: faculties faculty_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculties ALTER COLUMN faculty_id SET DEFAULT nextval('public.faculties_faculty_id_seq'::regclass);


--
-- Name: hashtags hashtag_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hashtags ALTER COLUMN hashtag_id SET DEFAULT nextval('public.hashtags_hashtag_id_seq'::regclass);


--
-- Name: posts post_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts ALTER COLUMN post_id SET DEFAULT nextval('public.posts_post_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (post_id, attachment_no);


--
-- Name: auth_limits auth_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_limits
    ADD CONSTRAINT auth_limits_pkey PRIMARY KEY (rate_key);


--
-- Name: campus_migrations campus_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campus_migrations
    ADD CONSTRAINT campus_migrations_pkey PRIMARY KEY (version);


--
-- Name: communities communities_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_name_key UNIQUE (name);


--
-- Name: communities communities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_pkey PRIMARY KEY (community_id);


--
-- Name: community_members community_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_pkey PRIMARY KEY (user_id, community_id);


--
-- Name: event_organizers event_organizers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_organizers
    ADD CONSTRAINT event_organizers_pkey PRIMARY KEY (user_id);


--
-- Name: event_tickets event_tickets_event_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_tickets
    ADD CONSTRAINT event_tickets_event_id_user_id_key UNIQUE (event_id, user_id);


--
-- Name: event_tickets event_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_tickets
    ADD CONSTRAINT event_tickets_pkey PRIMARY KEY (ticket_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (event_id);


--
-- Name: faculties faculties_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculties
    ADD CONSTRAINT faculties_name_key UNIQUE (name);


--
-- Name: faculties faculties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculties
    ADD CONSTRAINT faculties_pkey PRIMARY KEY (faculty_id);


--
-- Name: faculties faculties_short_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculties
    ADD CONSTRAINT faculties_short_name_key UNIQUE (short_name);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followee_id);


--
-- Name: hashtags hashtags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hashtags
    ADD CONSTRAINT hashtags_pkey PRIMARY KEY (hashtag_id);


--
-- Name: hashtags hashtags_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hashtags
    ADD CONSTRAINT hashtags_tag_key UNIQUE (tag);


--
-- Name: likes likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (user_id, post_id);


--
-- Name: mentors mentors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentors
    ADD CONSTRAINT mentors_pkey PRIMARY KEY (user_id);


--
-- Name: microsoft_flows microsoft_flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microsoft_flows
    ADD CONSTRAINT microsoft_flows_pkey PRIMARY KEY (browser_hash);


--
-- Name: microsoft_identities microsoft_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microsoft_identities
    ADD CONSTRAINT microsoft_identities_pkey PRIMARY KEY (tenant_id, object_id);


--
-- Name: microsoft_identities microsoft_identities_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microsoft_identities
    ADD CONSTRAINT microsoft_identities_user_id_key UNIQUE (user_id);


--
-- Name: microsoft_pending microsoft_pending_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microsoft_pending
    ADD CONSTRAINT microsoft_pending_pkey PRIMARY KEY (browser_hash);


--
-- Name: moderators moderators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderators
    ADD CONSTRAINT moderators_pkey PRIMARY KEY (user_id);


--
-- Name: post_hashtags post_hashtags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_hashtags
    ADD CONSTRAINT post_hashtags_pkey PRIMARY KEY (post_id, hashtag_id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (post_id);


--
-- Name: scholarship_holders scholarship_holders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scholarship_holders
    ADD CONSTRAINT scholarship_holders_pkey PRIMARY KEY (user_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (user_id);


--
-- Name: students students_student_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_student_number_key UNIQUE (student_number);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: event_tickets_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_tickets_user_idx ON public.event_tickets USING btree (user_id);


--
-- Name: events_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_starts_at_idx ON public.events USING btree (starts_at);


--
-- Name: idx_events_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_page ON public.events USING btree (starts_at, event_id);


--
-- Name: idx_follows_followee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_followee ON public.follows USING btree (followee_id);


--
-- Name: idx_likes_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_likes_post ON public.likes USING btree (post_id);


--
-- Name: idx_posts_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_author ON public.posts USING btree (author_id);


--
-- Name: idx_posts_community; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_community ON public.posts USING btree (community_id);


--
-- Name: idx_posts_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_created ON public.posts USING btree (created_at DESC);


--
-- Name: idx_posts_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_feed ON public.posts USING btree (created_at DESC, post_id DESC) WHERE (parent_post_id IS NULL);


--
-- Name: idx_posts_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_parent ON public.posts USING btree (parent_post_id);


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);


--
-- Name: users_email_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_lower_idx ON public.users USING btree (lower((email)::text));


--
-- Name: posts trg_reply_community; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reply_community BEFORE INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION public.inherit_reply_community();


--
-- Name: students trg_students_subtype; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_students_subtype BEFORE INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.check_user_subtype('student');


--
-- Name: teachers trg_teachers_subtype; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teachers_subtype BEFORE INSERT OR UPDATE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.check_user_subtype('teacher');


--
-- Name: attachments attachments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(post_id) ON DELETE CASCADE;


--
-- Name: community_members community_members_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(community_id) ON DELETE CASCADE;


--
-- Name: community_members community_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: event_organizers event_organizers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_organizers
    ADD CONSTRAINT event_organizers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: event_tickets event_tickets_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_tickets
    ADD CONSTRAINT event_tickets_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id) ON DELETE CASCADE;


--
-- Name: event_tickets event_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_tickets
    ADD CONSTRAINT event_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: events events_organizer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: follows follows_followee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: likes likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(post_id) ON DELETE CASCADE;


--
-- Name: likes likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: mentors mentors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentors
    ADD CONSTRAINT mentors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: microsoft_flows microsoft_flows_link_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microsoft_flows
    ADD CONSTRAINT microsoft_flows_link_user_id_fkey FOREIGN KEY (link_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: microsoft_identities microsoft_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microsoft_identities
    ADD CONSTRAINT microsoft_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: moderators moderators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderators
    ADD CONSTRAINT moderators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: post_hashtags post_hashtags_hashtag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_hashtags
    ADD CONSTRAINT post_hashtags_hashtag_id_fkey FOREIGN KEY (hashtag_id) REFERENCES public.hashtags(hashtag_id) ON DELETE CASCADE;


--
-- Name: post_hashtags post_hashtags_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_hashtags
    ADD CONSTRAINT post_hashtags_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(post_id) ON DELETE CASCADE;


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: posts posts_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(community_id) ON DELETE SET NULL;


--
-- Name: posts posts_parent_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_parent_post_id_fkey FOREIGN KEY (parent_post_id) REFERENCES public.posts(post_id) ON DELETE CASCADE;


--
-- Name: scholarship_holders scholarship_holders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scholarship_holders
    ADD CONSTRAINT scholarship_holders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.students(user_id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: students students_faculty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculties(faculty_id);


--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: teachers teachers_faculty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculties(faculty_id);


--
-- Name: teachers teachers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

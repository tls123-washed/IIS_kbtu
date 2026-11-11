-- Профили, сообщества и поиск.
CREATE OR REPLACE FUNCTION campus_api.read_profile(p_viewer INT, p_user INT)
RETURNS TABLE (
    user_id INT, username VARCHAR, full_name TEXT, user_type VARCHAR, faculty VARCHAR,
    year_of_study SMALLINT, "position" VARCHAR, is_mentor BOOLEAN, scholarship_type VARCHAR,
    followers BIGINT, following BIGINT, posts BIGINT, bio VARCHAR, moderator_level SMALLINT,
    i_follow BOOLEAN
)
LANGUAGE sql STABLE AS $$
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

CREATE OR REPLACE FUNCTION campus_api.profile_posts(p_viewer INT, p_user INT)
RETURNS SETOF campus_api.post_card
LANGUAGE sql STABLE AS $$
    SELECT card.*
    FROM public.posts p
    CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, p.post_id) card
    WHERE p.author_id = p_user AND p.parent_post_id IS NULL
      AND (NOT p.is_anonymous OR p.author_id = p_viewer)
    ORDER BY p.created_at DESC, p.post_id DESC LIMIT 20;
$$;

CREATE OR REPLACE PROCEDURE campus_api.update_bio(p_user INT, p_bio TEXT)
LANGUAGE sql AS $$
    UPDATE public.users SET bio = NULLIF(p_bio, '') WHERE user_id = p_user;
$$;

CREATE OR REPLACE PROCEDURE campus_api.set_follow(p_user INT, p_target INT, p_enabled BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_enabled THEN
        INSERT INTO public.follows (follower_id, followee_id) VALUES (p_user, p_target)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.follows WHERE follower_id = p_user AND followee_id = p_target;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION campus_api.list_communities(
    p_viewer INT, p_joined BOOLEAN DEFAULT FALSE, p_community INT DEFAULT NULL
)
RETURNS TABLE (community_id INT, name VARCHAR, description VARCHAR, members BIGINT, joined BOOLEAN)
LANGUAGE sql STABLE AS $$
    SELECT c.community_id, c.name, c.description, COUNT(m.user_id),
           COALESCE(BOOL_OR(m.user_id = p_viewer), FALSE)
    FROM public.communities c LEFT JOIN public.community_members m USING (community_id)
    WHERE p_community IS NULL OR c.community_id = p_community
    GROUP BY c.community_id
    HAVING NOT p_joined OR BOOL_OR(m.user_id = p_viewer)
    ORDER BY COUNT(m.user_id) DESC, c.name;
$$;

CREATE OR REPLACE FUNCTION campus_api.community_posts(p_viewer INT, p_community INT)
RETURNS SETOF campus_api.post_card
LANGUAGE sql STABLE AS $$
    SELECT card.*
    FROM public.posts p
    CROSS JOIN LATERAL campus_api.post_card_for(p_viewer, p.post_id) card
    WHERE p.community_id = p_community AND p.parent_post_id IS NULL
    ORDER BY p.created_at DESC, p.post_id DESC LIMIT 30;
$$;

CREATE OR REPLACE PROCEDURE campus_api.set_membership(p_user INT, p_community INT, p_enabled BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_enabled THEN
        INSERT INTO public.community_members (user_id, community_id) VALUES (p_user, p_community)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.community_members WHERE user_id = p_user AND community_id = p_community;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION campus_api.search(p_viewer INT, p_term TEXT, p_tag TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
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

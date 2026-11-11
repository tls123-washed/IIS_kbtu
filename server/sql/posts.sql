-- Лента, треды, публикация и лайки. Этот файл можно повторно выполнить в Query Tool.
CREATE OR REPLACE FUNCTION campus_api.post_card_for(p_viewer INT, p_post INT)
RETURNS SETOF campus_api.post_card
LANGUAGE sql STABLE AS $$
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

-- Курсор хранит дату и ID последнего видимого поста. ID различает одинаковые даты.
CREATE OR REPLACE FUNCTION campus_api.feed_page(
    p_viewer INT, p_following BOOLEAN DEFAULT FALSE, p_limit INT DEFAULT 30,
    p_after_time TIMESTAMPTZ DEFAULT NULL, p_after_id INT DEFAULT NULL
)
RETURNS SETOF campus_api.post_card
LANGUAGE sql STABLE AS $$
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

CREATE OR REPLACE FUNCTION campus_api.read_thread(p_viewer INT, p_post INT)
RETURNS TABLE (depth INT, card campus_api.post_card)
LANGUAGE sql STABLE AS $$
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

-- Публикация и связи с хэштегами выполняются одним вызовом, в одной транзакции.
CREATE OR REPLACE FUNCTION campus_api.publish_post(
    p_user INT, p_community INT, p_parent INT, p_content TEXT, p_anonymous BOOLEAN, p_tags TEXT[]
)
RETURNS TABLE (post_id INT, community_id INT)
LANGUAGE plpgsql VOLATILE AS $$
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

-- После миграции 7 актуальное определение удаления находится в moderation.sql.
CREATE OR REPLACE FUNCTION campus_api.delete_post(p_user INT, p_post INT)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE AS $$
    WITH deleted AS (
        DELETE FROM public.posts WHERE author_id = p_user AND post_id = p_post RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

CREATE OR REPLACE FUNCTION campus_api.set_like(p_user INT, p_post INT, p_enabled BOOLEAN)
RETURNS TABLE (like_count BIGINT, liked BOOLEAN)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF p_enabled THEN
        INSERT INTO public.likes (user_id, post_id) VALUES (p_user, p_post) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.likes WHERE user_id = p_user AND post_id = p_post;
    END IF;
    RETURN QUERY SELECT card.like_count, card.liked FROM campus_api.post_card_for(p_user, p_post) card;
END;
$$;

-- Владелец запускает выдачу и отзыв ролей из меню Windows или Query Tool.
CREATE OR REPLACE FUNCTION campus_api.change_moderator(
    p_username TEXT, p_enabled BOOLEAN, p_community TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
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

-- Доступ к удалению зависит от роли на сайте или в сообществе автора запроса.
CREATE OR REPLACE FUNCTION campus_api.post_moderation(p_user INT)
RETURNS TABLE (site_wide BOOLEAN, community_ids INT[])
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.moderators WHERE user_id = p_user AND access_level = 2
    ), ARRAY(
        SELECT community_id FROM public.community_members
        WHERE user_id = p_user AND role IN ('admin', 'moderator')
    );
$$;

CREATE OR REPLACE FUNCTION campus_api.delete_post(p_user INT, p_post INT)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE AS $$
    WITH deleted AS (
        DELETE FROM public.posts p USING campus_api.post_moderation(p_user) rights
        WHERE p.post_id = p_post
          AND (p.author_id = p_user OR rights.site_wide OR p.community_id = ANY(rights.community_ids))
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

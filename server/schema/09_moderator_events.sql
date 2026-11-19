-- Одно правило применяется к показу кнопки и публикации через API.
-- Отдельная роль организатора сохраняется независимо от модерки.
CREATE OR REPLACE FUNCTION campus_api.can_create_event(p_user INT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.event_organizers WHERE user_id = p_user)
        OR EXISTS (
            SELECT 1 FROM public.moderators
            WHERE user_id = p_user AND access_level = 2
        );
$$;

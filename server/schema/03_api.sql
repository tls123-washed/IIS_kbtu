-- Таблицы и данные остаются в public. Здесь собраны операции приложения.
CREATE SCHEMA IF NOT EXISTS campus_api;

-- Единый формат карточки треда для ленты, поиска и профилей.
CREATE TYPE campus_api.post_card AS (
    post_id INT, parent_post_id INT, author TEXT, content TEXT, community TEXT,
    created_at TIMESTAMPTZ, like_count BIGINT, reply_count BIGINT,
    is_anonymous BOOLEAN, community_id INT, author_id INT, full_name TEXT,
    mine BOOLEAN, liked BOOLEAN
);

CREATE INDEX idx_posts_feed ON public.posts (created_at DESC, post_id DESC)
    WHERE parent_post_id IS NULL;
CREATE INDEX idx_events_page ON public.events (starts_at, event_id);

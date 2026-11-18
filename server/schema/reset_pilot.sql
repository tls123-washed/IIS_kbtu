-- Полностью удаляет содержимое пилота. Запускайте при остановленном приложении
-- после pg_dump и проверки имени базы и сервера.
BEGIN;
SET LOCAL search_path TO public;
DO $$
BEGIN
    IF current_database() <> 'campus_threads_pilot'
        OR to_regclass('public.campus_migrations') IS NULL THEN
        RAISE EXCEPTION 'Сброс разрешён только в базе campus_threads_pilot с миграциями';
    END IF;
END
$$;
TRUNCATE users, students, teachers, mentors, moderators, scholarship_holders,
    communities, community_members, posts, likes, follows, attachments,
    hashtags, post_hashtags, sessions, auth_limits, events, event_tickets,
    microsoft_flows, microsoft_pending, microsoft_identities, event_organizers
RESTART IDENTITY;
COMMIT;

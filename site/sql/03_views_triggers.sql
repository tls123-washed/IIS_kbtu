-- =====================================================================
-- Campus Threads — файл 3 из 4: представления, функции, триггеры
-- =====================================================================

-- ---------------------------------------------------------------------
-- ПРЕДСТАВЛЕНИЕ (VIEW) — сохранённый SELECT, с которым работают как с таблицей.
-- Здесь же считаются ПРОИЗВОДНЫЕ атрибуты из EER: like_count и reply_count.
-- Их не храним в таблице, а вычисляем — так они никогда не «разъедутся» с данными.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_post_details AS
SELECT
    p.post_id,
    p.parent_post_id,
    CASE WHEN p.is_anonymous THEN 'Аноним' ELSE u.username END AS author,
    p.content,
    c.name                                                     AS community,
    p.created_at,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.post_id)        AS like_count,
    (SELECT COUNT(*) FROM posts r WHERE r.parent_post_id = p.post_id) AS reply_count
FROM posts p
JOIN users u            ON u.user_id = p.author_id
LEFT JOIN communities c ON c.community_id = p.community_id;   -- LEFT: у поста может не быть сообщества

-- Профиль пользователя: общие поля + поля подкласса + счётчики.
CREATE OR REPLACE VIEW v_user_profiles AS
SELECT
    u.user_id,
    u.username,
    u.first_name || ' ' || u.last_name                               AS full_name,
    u.user_type,
    f.short_name                                                     AS faculty,
    s.year_of_study,
    t.position,
    (m.user_id  IS NOT NULL)                                         AS is_mentor,
    sh.scholarship_type,
    (SELECT COUNT(*) FROM follows WHERE followee_id = u.user_id)     AS followers,
    (SELECT COUNT(*) FROM follows WHERE follower_id = u.user_id)     AS following,
    (SELECT COUNT(*) FROM posts   WHERE author_id  = u.user_id)      AS posts
FROM users u
LEFT JOIN students  s ON s.user_id = u.user_id
LEFT JOIN teachers  t ON t.user_id = u.user_id
LEFT JOIN mentors   m ON m.user_id = u.user_id
LEFT JOIN scholarship_holders sh ON sh.user_id = u.user_id
LEFT JOIN faculties f ON f.faculty_id = COALESCE(s.faculty_id, t.faculty_id);

-- ---------------------------------------------------------------------
-- ТРИГГЕР 1: соблюдаем disjoint-специализацию.
-- В students можно добавить только пользователя с user_type = 'student',
-- в teachers — только с user_type = 'teacher'.
-- Обычным CHECK это не сделать (CHECK не видит другие таблицы) — нужен триггер.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_user_subtype() RETURNS TRIGGER AS $$
DECLARE
    actual_type VARCHAR;
BEGIN
    SELECT user_type INTO actual_type FROM users WHERE user_id = NEW.user_id;
    IF actual_type IS DISTINCT FROM TG_ARGV[0] THEN
        RAISE EXCEPTION 'Пользователь % имеет тип %, а не %', NEW.user_id, actual_type, TG_ARGV[0];
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_students_subtype ON students;
CREATE TRIGGER trg_students_subtype
    BEFORE INSERT OR UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION check_user_subtype('student');

DROP TRIGGER IF EXISTS trg_teachers_subtype ON teachers;
CREATE TRIGGER trg_teachers_subtype
    BEFORE INSERT OR UPDATE ON teachers
    FOR EACH ROW EXECUTE FUNCTION check_user_subtype('teacher');

-- ---------------------------------------------------------------------
-- ТРИГГЕР 2: ответ автоматически попадает в то же сообщество, что и исходный пост.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inherit_reply_community() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.parent_post_id IS NOT NULL THEN
        SELECT community_id INTO NEW.community_id FROM posts WHERE post_id = NEW.parent_post_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reply_community ON posts;
CREATE TRIGGER trg_reply_community
    BEFORE INSERT ON posts
    FOR EACH ROW EXECUTE FUNCTION inherit_reply_community();

-- ---------------------------------------------------------------------
-- ФУНКЦИЯ: лента пользователя — посты тех, на кого он подписан (без ответов).
-- Использование: SELECT * FROM get_feed(1, 20);
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_feed(p_user_id INT, p_limit INT DEFAULT 20)
RETURNS TABLE (post_id INT, author TEXT, content VARCHAR, community VARCHAR,
               created_at TIMESTAMP, like_count BIGINT, reply_count BIGINT) AS $$
    SELECT d.post_id, d.author, d.content, d.community, d.created_at, d.like_count, d.reply_count
    FROM v_post_details d
    JOIN posts p ON p.post_id = d.post_id
    WHERE p.parent_post_id IS NULL
      AND p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = p_user_id)
    ORDER BY d.created_at DESC
    LIMIT p_limit;
$$ LANGUAGE sql STABLE;

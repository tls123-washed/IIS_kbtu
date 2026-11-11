-- =====================================================================
-- Campus Threads — файл 6: overlapping-специализация USER → {MODERATOR, MENTOR}
--
-- Было:  STUDENT → (o) → MENTOR, SCHOLARSHIP_HOLDER
-- Стало: USER    → (o) → MODERATOR, MENTOR
--        Любой пользователь (студент ИЛИ преподаватель) может быть модератором,
--        ментором, обоими сразу или никем (overlapping, partial).
--
-- Порядок запуска всей базы: 01 → 02 → 03 → 06 → (04, 05 — по желанию)
-- Файл можно запускать повторно.
-- Запускай ЦЕЛИКОМ (F5) в Query Tool базы campus_threads.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. MENTOR теперь подкласс USER, а не STUDENT.
--    Меняем внешний ключ: mentors.user_id → users.user_id
-- ---------------------------------------------------------------------
ALTER TABLE mentors DROP CONSTRAINT IF EXISTS mentors_user_id_fkey;
ALTER TABLE mentors
    ADD CONSTRAINT mentors_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 2. MODERATOR — новый подкласс USER.
--    access_level: 1 — модерирует сообщества (удаляет посты, отвечает на жалобы)
--                  2 — модератор всей платформы (плюс блокировка пользователей)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS moderators CASCADE;
CREATE TABLE moderators (
    user_id      INT      PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    access_level SMALLINT NOT NULL DEFAULT 1 CHECK (access_level IN (1, 2)),
    assigned_at  DATE     NOT NULL DEFAULT CURRENT_DATE
);

-- ---------------------------------------------------------------------
-- 3. Данные
-- ---------------------------------------------------------------------
-- 3a. Два преподавателя тоже становятся менторами (раньше было нельзя)
INSERT INTO mentors (user_id, subject, mentor_since)
SELECT user_id, 'Научная работа', DATE '2026-09-01'
FROM teachers
ORDER BY user_id
LIMIT 2
ON CONFLICT (user_id) DO NOTHING;

-- 3b. Три преподавателя — модераторы 2 уровня
INSERT INTO moderators (user_id, access_level, assigned_at)
SELECT user_id, 2, DATE '2026-09-01'
FROM teachers
ORDER BY user_id
LIMIT 3;

-- 3c. Три студента-ментора — ещё и модераторы 1 уровня (это и есть overlap)
INSERT INTO moderators (user_id, access_level, assigned_at)
SELECT m.user_id, 1, DATE '2026-09-10'
FROM mentors m
JOIN students s ON s.user_id = m.user_id
ORDER BY m.user_id
LIMIT 3;

-- 3d. Два студента-модератора без менторства
INSERT INTO moderators (user_id, access_level, assigned_at)
SELECT s.user_id, 1, DATE '2026-09-15'
FROM students s
WHERE s.user_id NOT IN (SELECT user_id FROM mentors)
ORDER BY s.user_id
LIMIT 2;

-- ---------------------------------------------------------------------
-- 4. Профиль пользователя: добавляем уровень модератора
--    (CREATE OR REPLACE VIEW разрешает добавлять столбцы только в конец)
-- ---------------------------------------------------------------------
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
    (SELECT COUNT(*) FROM posts   WHERE author_id  = u.user_id)      AS posts,
    mo.access_level                                                  AS moderator_level
FROM users u
LEFT JOIN students  s ON s.user_id = u.user_id
LEFT JOIN teachers  t ON t.user_id = u.user_id
LEFT JOIN mentors   m ON m.user_id = u.user_id
LEFT JOIN moderators mo ON mo.user_id = u.user_id
LEFT JOIN scholarship_holders sh ON sh.user_id = u.user_id
LEFT JOIN faculties f ON f.faculty_id = COALESCE(s.faculty_id, t.faculty_id);

-- ---------------------------------------------------------------------
-- (Необязательно) Если SCHOLARSHIP_HOLDER на диаграмме больше нет —
-- раскомментируй две строки ниже, чтобы база совпадала с диаграммой.
-- Тогда из v_user_profiles тоже надо убрать sh.scholarship_type и JOIN.
-- ---------------------------------------------------------------------
-- DROP VIEW v_user_profiles;
-- DROP TABLE scholarship_holders;

COMMIT;

-- ---------------------------------------------------------------------
-- 5. Проверка: кто есть кто (этот запрос последний — его результат увидишь)
-- ---------------------------------------------------------------------
SELECT u.user_id,
       u.username,
       u.user_type,                                          -- disjoint: student / teacher
       (mo.user_id IS NOT NULL) AS is_moderator,             -- overlapping
       mo.access_level,
       (me.user_id IS NOT NULL) AS is_mentor,                -- overlapping
       me.subject
FROM users u
LEFT JOIN moderators mo ON mo.user_id = u.user_id
LEFT JOIN mentors    me ON me.user_id = u.user_id
WHERE mo.user_id IS NOT NULL OR me.user_id IS NOT NULL
ORDER BY (mo.user_id IS NOT NULL AND me.user_id IS NOT NULL) DESC, u.user_type, u.user_id;

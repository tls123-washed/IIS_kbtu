-- =====================================================================
-- Campus Threads — файл 4: демонстрационные запросы
-- Запускай ПО ОДНОМУ: выдели запрос мышкой → F5. pgAdmin показывает результат
-- только последнего запроса, поэтому весь файл целиком запускать бессмысленно.
--
-- Часть A. Чтение данных (SELECT): JOIN, GROUP BY, HAVING, подзапросы
-- Часть B. Изменение данных (DML): INSERT, UPDATE, DELETE
-- Часть C. Изменение структуры (DDL): ALTER TABLE, TRUNCATE, DROP
-- Проверка ограничений — в файле 05_constraint_checks.sql
-- Уровни: [1] базовый, [2] средний, [3] продвинутый
-- =====================================================================

-- #####################################################################
-- ЧАСТЬ A. ЧТЕНИЕ ДАННЫХ
-- #####################################################################

-- [1] Q1. Все студенты 1 курса, по алфавиту
SELECT u.first_name, u.last_name, s.student_number
FROM users u
JOIN students s ON s.user_id = u.user_id
WHERE s.year_of_study = 1
ORDER BY u.last_name, u.first_name;

-- [1] Q2. 10 последних постов верхнего уровня (не ответов)
SELECT post_id, author, content, created_at
FROM v_post_details
WHERE parent_post_id IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- [2] Q3. Сколько студентов на каждом факультете (GROUP BY + агрегат)
SELECT f.short_name, f.name, COUNT(s.user_id) AS students
FROM faculties f
LEFT JOIN students s ON s.faculty_id = f.faculty_id
GROUP BY f.faculty_id
ORDER BY students DESC;

-- [2] Q4. Топ-10 самых залайканных постов
SELECT post_id, author, content, like_count, reply_count
FROM v_post_details
ORDER BY like_count DESC, reply_count DESC
LIMIT 10;

-- [2] Q5. Сообщества с числом участников больше 20 (HAVING фильтрует группы)
SELECT c.name, COUNT(*) AS members
FROM communities c
JOIN community_members m ON m.community_id = c.community_id
GROUP BY c.community_id
HAVING COUNT(*) > 20
ORDER BY members DESC;

-- [2] Q6. Трендовые хэштеги за последние 14 дней
SELECT h.tag, COUNT(*) AS uses
FROM hashtags h
JOIN post_hashtags ph ON ph.hashtag_id = h.hashtag_id
JOIN posts p          ON p.post_id = ph.post_id
WHERE p.created_at >= TIMESTAMP '2026-09-28' - INTERVAL '14 days'
GROUP BY h.tag
ORDER BY uses DESC
LIMIT 10;

-- [2] Q7. Пользователи, которые ни разу ничего не написали (подзапрос NOT EXISTS)
SELECT u.username, u.user_type
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.user_id);

-- [2] Q8. Взаимные подписки (self-join рекурсивной связи FOLLOWS)
SELECT a.username AS user_1, b.username AS user_2
FROM follows f1
JOIN follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
JOIN users a    ON a.user_id = f1.follower_id
JOIN users b    ON b.user_id = f1.followee_id
WHERE f1.follower_id < f1.followee_id;      -- чтобы каждая пара вывелась один раз

-- [2] Q9. Профиль пользователя со счётчиками (через представление)
SELECT * FROM v_user_profiles WHERE username = 'adilet_tleu';

-- [2] Q10. Лента пользователя №1 (через функцию)
SELECT * FROM get_feed(1, 10);

-- [3] Q11. Всё дерево ответов под постом (рекурсивный CTE для REPLIES_TO)
WITH RECURSIVE thread AS (
    SELECT post_id, parent_post_id, content, 0 AS depth
    FROM posts
    WHERE post_id = 91           -- корень треда; поменяй на любой другой post_id
    UNION ALL
    SELECT p.post_id, p.parent_post_id, p.content, t.depth + 1
    FROM posts p
    JOIN thread t ON p.parent_post_id = t.post_id
)
SELECT repeat('    ', depth) || content AS thread_view, depth
FROM thread;

-- [3] Q12. Самый популярный автор в каждом сообществе (оконная функция RANK)
SELECT community, username, total_likes
FROM (
    SELECT c.name AS community, u.username, COUNT(l.post_id) AS total_likes,
           RANK() OVER (PARTITION BY c.community_id ORDER BY COUNT(l.post_id) DESC) AS rnk
    FROM posts p
    JOIN communities c ON c.community_id = p.community_id
    JOIN users u       ON u.user_id = p.author_id
    LEFT JOIN likes l  ON l.post_id = p.post_id
    WHERE p.is_anonymous = FALSE
    GROUP BY c.community_id, c.name, u.username
) ranked
WHERE rnk = 1
ORDER BY total_likes DESC;

-- [3] Q13. Рекомендации «на кого подписаться»: друзья друзей, на которых я ещё не подписан
SELECT u.username, COUNT(*) AS mutual_friends
FROM follows my
JOIN follows theirs ON theirs.follower_id = my.followee_id
JOIN users u        ON u.user_id = theirs.followee_id
WHERE my.follower_id = 1
  AND theirs.followee_id <> 1
  AND theirs.followee_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = 1)
GROUP BY u.username
ORDER BY mutual_friends DESC
LIMIT 5;

-- [3] Q14. Посты с вложениями (слабая сущность ATTACHMENT) и количеством файлов
SELECT p.post_id, p.content, COUNT(a.attachment_no) AS files,
       string_agg(a.file_type, ', ' ORDER BY a.attachment_no) AS types
FROM posts p
JOIN attachments a ON a.post_id = p.post_id
GROUP BY p.post_id
ORDER BY files DESC;

-- [2] Q15. Overlapping-специализация USER → {MODERATOR, MENTOR}:
--          пользователи, которые одновременно модераторы И менторы (нужен файл 06)
SELECT u.username, u.user_type, mo.access_level, me.subject
FROM users u
JOIN moderators mo ON mo.user_id = u.user_id
JOIN mentors    me ON me.user_id = u.user_id
ORDER BY u.user_type, u.username;

-- [2] Q16. Средняя стипендия по типам, только типы с 2+ стипендиатами (GROUP BY + HAVING)
SELECT scholarship_type, COUNT(*) AS students, ROUND(AVG(monthly_amount)) AS avg_amount
FROM scholarship_holders
GROUP BY scholarship_type
HAVING COUNT(*) >= 2
ORDER BY avg_amount DESC;

-- [2] Q17. Посты, у которых лайков больше среднего (подзапрос в WHERE)
SELECT post_id, author, content, like_count
FROM v_post_details
WHERE like_count > (SELECT AVG(like_count) FROM v_post_details)
ORDER BY like_count DESC
LIMIT 15;


-- #####################################################################
-- ЧАСТЬ B. ИЗМЕНЕНИЕ ДАННЫХ (DML)
-- Работаем с новым демо-пользователем, чтобы не портить датасет.
-- В конце он удаляется, поэтому блок можно запускать повторно.
-- #####################################################################

-- B1. INSERT: новый пользователь. created_at не указываем — сработает DEFAULT now()
INSERT INTO users (username, email, password_hash, first_name, last_name, user_type)
VALUES ('demo_student', 'demo_student@stud.campus.kz', 'hash', 'Демо', 'Студентов', 'student')
RETURNING user_id, username, created_at;

-- B2. INSERT в подкласс STUDENT (user_id берём подзапросом)
INSERT INTO students (user_id, student_number, year_of_study, faculty_id)
VALUES ((SELECT user_id FROM users WHERE username = 'demo_student'), '26B00001', 1, 1)
RETURNING *;

-- B3. INSERT: пост. is_anonymous не указываем — DEFAULT FALSE
INSERT INTO posts (author_id, content)
VALUES ((SELECT user_id FROM users WHERE username = 'demo_student'), 'Всем привет, я новенький! #привет')
RETURNING post_id, content, is_anonymous, created_at;

-- B4. INSERT нескольких строк за раз: 3 пользователя лайкают пост демо-студента
INSERT INTO likes (user_id, post_id)
SELECT u.user_id, p.post_id
FROM users u, posts p
WHERE u.user_id IN (2, 3, 4)
  AND p.author_id = (SELECT user_id FROM users WHERE username = 'demo_student')
RETURNING *;

-- B5. UPDATE: заполнить био
UPDATE users SET bio = 'Первокурсник, учу SQL'
WHERE username = 'demo_student'
RETURNING username, bio;

-- B6. UPDATE нескольких строк: перевести всех студентов 4 курса факультета SITE на 5 курс (и сразу вернуть назад)
UPDATE students SET year_of_study = year_of_study + 1
WHERE year_of_study = 4 AND faculty_id = 1
RETURNING user_id, year_of_study;

UPDATE students SET year_of_study = year_of_study - 1
WHERE year_of_study = 5 AND faculty_id = 1;

-- B7. DELETE: удалить пост. ON DELETE CASCADE автоматически удалит его лайки
SELECT COUNT(*) AS likes_before FROM likes
WHERE post_id IN (SELECT post_id FROM posts WHERE author_id = (SELECT user_id FROM users WHERE username = 'demo_student'));

DELETE FROM posts
WHERE author_id = (SELECT user_id FROM users WHERE username = 'demo_student')
RETURNING post_id, content;

-- B8. DELETE: удалить пользователя. Каскадом удалится и строка в students
DELETE FROM users WHERE username = 'demo_student' RETURNING user_id, username;


-- #####################################################################
-- ЧАСТЬ C. ИЗМЕНЕНИЕ СТРУКТУРЫ (DDL)
-- В конце всё возвращается как было.
-- #####################################################################

-- C1. ALTER TABLE ... ADD COLUMN: добавить телефон (необязательный, но уникальный)
ALTER TABLE users ADD COLUMN phone VARCHAR(20) UNIQUE;

-- C2. ADD COLUMN с DEFAULT: у всех существующих строк сразу появится значение FALSE
ALTER TABLE communities ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT FALSE;
SELECT community_id, name, is_private FROM communities;

-- C3. ALTER COLUMN TYPE: увеличить длину био со 160 до 200 символов
ALTER TABLE users ALTER COLUMN bio TYPE VARCHAR(200);

-- C4. ADD CONSTRAINT: телефон должен начинаться с +7
ALTER TABLE users ADD CONSTRAINT chk_phone_kz CHECK (phone LIKE '+7%');
UPDATE users SET phone = '+77011234567' WHERE user_id = 1 RETURNING username, phone;

-- C5. RENAME COLUMN
ALTER TABLE communities RENAME COLUMN is_private TO is_closed;

-- C6. CREATE + TRUNCATE + DROP на временной таблице журнала входов
CREATE TABLE login_logs (
    log_id    SERIAL    PRIMARY KEY,
    user_id   INT       NOT NULL REFERENCES users(user_id),
    logged_at TIMESTAMP NOT NULL DEFAULT now()
);
INSERT INTO login_logs (user_id) SELECT user_id FROM users;   -- 60 строк
SELECT COUNT(*) AS rows_before_truncate FROM login_logs;

TRUNCATE TABLE login_logs RESTART IDENTITY;   -- удаляет ВСЕ строки разом, структура остаётся
SELECT COUNT(*) AS rows_after_truncate FROM login_logs;

DROP TABLE login_logs;                        -- удаляет таблицу целиком вместе со структурой

-- C7. Возвращаем схему в исходное состояние (DROP COLUMN, DROP CONSTRAINT)
ALTER TABLE users DROP CONSTRAINT chk_phone_kz;
ALTER TABLE users DROP COLUMN phone;
ALTER TABLE communities DROP COLUMN is_closed;
ALTER TABLE users ALTER COLUMN bio TYPE VARCHAR(160);

-- Разница между DELETE, TRUNCATE и DROP:
--   DELETE FROM t WHERE ...  — удаляет выбранные строки, можно с условием, срабатывают триггеры
--   TRUNCATE t               — мгновенно удаляет ВСЕ строки, без условия, структура остаётся
--   DROP TABLE t             — удаляет саму таблицу: и данные, и структуру

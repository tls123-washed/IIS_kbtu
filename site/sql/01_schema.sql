-- =====================================================================
-- Campus Threads — схема базы данных (PostgreSQL)
-- Файл 1 из 4: создание таблиц (DDL — Data Definition Language)
--
-- Порядок запуска: 01_schema.sql → 02_seed.sql → 03_views_triggers.sql → 06_moderator_mentor.sql → 04 / 05
-- Для пересоздания учебной базы сначала запустите 00_demo_reset.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- FACULTY — факультет (школа) университета
-- ---------------------------------------------------------------------
CREATE TABLE faculties (
    faculty_id  SERIAL       PRIMARY KEY,          -- SERIAL = автоинкремент 1, 2, 3...
    name        VARCHAR(100) NOT NULL UNIQUE,
    short_name  VARCHAR(10)  NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------
-- USER — суперкласс. Общие поля для всех пользователей.
-- Составной атрибут full_name из EER превращается в два столбца.
-- user_type — «определяющий атрибут» специализации (disjoint):
-- пользователь либо студент, либо преподаватель, но не оба сразу.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id       SERIAL       PRIMARY KEY,
    username      VARCHAR(30)  NOT NULL UNIQUE
                  CHECK (username ~ '^[a-z0-9_.]{3,30}$'),   -- только латиница, цифры, _ и .
    email         VARCHAR(100) NOT NULL UNIQUE
                  CHECK (email LIKE '%_@_%._%'),
    password_hash VARCHAR(255) NOT NULL,                     -- НИКОГДА не храним пароль открытым текстом
    first_name    VARCHAR(50)  NOT NULL,
    last_name     VARCHAR(50)  NOT NULL,
    bio           VARCHAR(160),                              -- NULL разрешён: био необязательно
    user_type     VARCHAR(10)  NOT NULL
                  CHECK (user_type IN ('student', 'teacher')),
    created_at    TIMESTAMP    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- STUDENT и TEACHER — подклассы USER.
-- Первичный ключ подкласса = внешний ключ на суперкласс (связь 1:1).
-- Связь STUDIES_AT / WORKS_AT (N:1, полное участие) → NOT NULL внешний ключ.
-- ---------------------------------------------------------------------
CREATE TABLE students (
    user_id        INT         PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    student_number VARCHAR(12) NOT NULL UNIQUE,
    year_of_study  SMALLINT    NOT NULL CHECK (year_of_study BETWEEN 1 AND 6),
    faculty_id     INT         NOT NULL REFERENCES faculties(faculty_id)
);

CREATE TABLE teachers (
    user_id    INT         PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    position   VARCHAR(50) NOT NULL,
    faculty_id INT         NOT NULL REFERENCES faculties(faculty_id)
);

-- ---------------------------------------------------------------------
-- MENTOR и SCHOLARSHIP_HOLDER — OVERLAPPING-специализация STUDENT.
-- Один студент может быть одновременно и ментором, и стипендиатом (overlapping),
-- а может не быть ни тем, ни другим (partial).
-- Поэтому определяющего атрибута нет: принадлежность = наличие строки в таблице подкласса.
-- ---------------------------------------------------------------------
CREATE TABLE mentors (
    user_id      INT         PRIMARY KEY REFERENCES students(user_id) ON DELETE CASCADE,
    subject      VARCHAR(60) NOT NULL,                       -- по какому предмету помогает первокурсникам
    mentor_since DATE        NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE scholarship_holders (
    user_id          INT          PRIMARY KEY REFERENCES students(user_id) ON DELETE CASCADE,
    scholarship_type VARCHAR(20)  NOT NULL
                     CHECK (scholarship_type IN ('state', 'university', 'presidential', 'corporate')),
    monthly_amount   NUMERIC(9,2) NOT NULL CHECK (monthly_amount > 0)   -- в тенге
);

-- ---------------------------------------------------------------------
-- COMMUNITY — сообщество (клуб, группа по предмету, общежитие и т.д.)
-- ---------------------------------------------------------------------
CREATE TABLE communities (
    community_id SERIAL       PRIMARY KEY,
    name         VARCHAR(60)  NOT NULL UNIQUE,
    description  VARCHAR(300),
    created_at   TIMESTAMP    NOT NULL DEFAULT now()
);

-- MEMBER_OF — связь M:N между USER и COMMUNITY с атрибутами role и joined_at.
-- M:N всегда превращается в отдельную таблицу с составным первичным ключом.
CREATE TABLE community_members (
    user_id      INT         NOT NULL REFERENCES users(user_id)             ON DELETE CASCADE,
    community_id INT         NOT NULL REFERENCES communities(community_id)  ON DELETE CASCADE,
    role         VARCHAR(10) NOT NULL DEFAULT 'member'
                 CHECK (role IN ('member', 'moderator', 'admin')),
    joined_at    TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, community_id)
);

-- ---------------------------------------------------------------------
-- POST — тред / пост.
--   WRITES     (USER 1:N POST, полное участие POST)  → author_id NOT NULL
--   POSTED_IN  (COMMUNITY 1:N POST, частичное)       → community_id может быть NULL
--   REPLIES_TO (рекурсивная 1:N)                     → parent_post_id ссылается на ту же таблицу
-- ---------------------------------------------------------------------
CREATE TABLE posts (
    post_id        SERIAL       PRIMARY KEY,
    author_id      INT          NOT NULL REFERENCES users(user_id)            ON DELETE CASCADE,
    community_id   INT                   REFERENCES communities(community_id) ON DELETE SET NULL,
    parent_post_id INT                   REFERENCES posts(post_id)            ON DELETE CASCADE,
    content        VARCHAR(500) NOT NULL CHECK (length(trim(content)) > 0),
    is_anonymous   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMP    NOT NULL DEFAULT now(),
    CHECK (parent_post_id IS NULL OR parent_post_id <> post_id)   -- пост не может отвечать сам себе
);

-- ---------------------------------------------------------------------
-- ATTACHMENT — СЛАБАЯ сущность: без поста вложение не существует.
-- Ключ = ключ владельца (post_id) + частичный ключ (attachment_no).
-- ---------------------------------------------------------------------
CREATE TABLE attachments (
    post_id       INT          NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    attachment_no SMALLINT     NOT NULL CHECK (attachment_no BETWEEN 1 AND 4),  -- до 4 файлов на пост
    file_url      VARCHAR(300) NOT NULL,
    file_type     VARCHAR(10)  NOT NULL CHECK (file_type IN ('image', 'video', 'file')),
    PRIMARY KEY (post_id, attachment_no)
);

-- LIKES — M:N между USER и POST с атрибутом liked_at.
CREATE TABLE likes (
    user_id  INT       NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    post_id  INT       NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    liked_at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)          -- один пользователь лайкает пост только один раз
);

-- FOLLOWS — рекурсивная M:N (USER подписан на USER).
CREATE TABLE follows (
    follower_id INT       NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,  -- кто подписан
    followee_id INT       NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,  -- на кого
    followed_at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)      -- нельзя подписаться на себя
);

-- HASHTAG и TAGGED (M:N между POST и HASHTAG).
CREATE TABLE hashtags (
    hashtag_id SERIAL      PRIMARY KEY,
    tag        VARCHAR(50) NOT NULL UNIQUE CHECK (tag ~ '^[a-zа-яё0-9_]+$')
);

CREATE TABLE post_hashtags (
    post_id    INT NOT NULL REFERENCES posts(post_id)       ON DELETE CASCADE,
    hashtag_id INT NOT NULL REFERENCES hashtags(hashtag_id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, hashtag_id)
);

-- ---------------------------------------------------------------------
-- Индексы — ускоряют частые запросы (как оглавление в книге).
-- Для PRIMARY KEY и UNIQUE индексы создаются автоматически.
-- ---------------------------------------------------------------------
CREATE INDEX idx_posts_author     ON posts(author_id);
CREATE INDEX idx_posts_parent     ON posts(parent_post_id);
CREATE INDEX idx_posts_community  ON posts(community_id);
CREATE INDEX idx_posts_created    ON posts(created_at DESC);   -- лента сортируется по дате
CREATE INDEX idx_likes_post       ON likes(post_id);
CREATE INDEX idx_follows_followee ON follows(followee_id);

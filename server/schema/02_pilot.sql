-- Серверная часть. Исходная модель соцсети находится в site/sql.
ALTER TABLE mentors DROP CONSTRAINT mentors_user_id_fkey;
ALTER TABLE mentors ADD FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
CREATE TABLE moderators (
    user_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    access_level SMALLINT NOT NULL DEFAULT 1 CHECK (access_level IN (1, 2)),
    assigned_at DATE NOT NULL DEFAULT CURRENT_DATE
);

ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD CONSTRAINT verified_kbtu_email
    CHECK (email_verified_at IS NULL OR email ~ '^[a-z0-9_+%-]+([.][a-z0-9_+%-]+)*@kbtu[.]kz$');
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE email_codes (
    email VARCHAR(100) PRIMARY KEY,
    code_hash CHAR(64) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
);

CREATE TABLE sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE auth_limits (
    rate_key CHAR(64) PRIMARY KEY,
    hits INT NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE events (
    event_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(100) NOT NULL CHECK (length(trim(title)) > 0),
    description VARCHAR(600) NOT NULL DEFAULT '',
    venue VARCHAR(120) NOT NULL CHECK (length(trim(venue)) > 0),
    starts_at TIMESTAMPTZ NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0)
);
CREATE INDEX events_starts_at_idx ON events (starts_at);

CREATE TABLE event_tickets (
    ticket_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id INT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, user_id)
);
CREATE INDEX event_tickets_user_idx ON event_tickets (user_id);

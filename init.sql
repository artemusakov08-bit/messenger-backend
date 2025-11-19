-- Создание таблицы пользователей
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255),
    display_name VARCHAR(255),
    status VARCHAR(20) DEFAULT 'offline',
    custom_status VARCHAR(255) DEFAULT 'В сети',
    last_seen BIGINT,
    profile_image TEXT,
    phone_number VARCHAR(20),
    bio TEXT,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- Создание таблицы чатов
CREATE TABLE IF NOT EXISTS chats (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255),
    type VARCHAR(20) DEFAULT 'private',
    last_message TEXT,
    timestamp BIGINT,
    created_by VARCHAR(50)
);

-- Создание таблицы сообщений
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(50) PRIMARY KEY,
    chat_id VARCHAR(50) NOT NULL,
    text TEXT,
    sender_id VARCHAR(50) NOT NULL,
    sender_name VARCHAR(255),
    timestamp BIGINT NOT NULL,
    type VARCHAR(20) DEFAULT 'text',
    media_url TEXT,
    media_caption TEXT,
    edited BOOLEAN DEFAULT false,
    replied_to VARCHAR(50)
);

-- Создание таблицы групп
CREATE TABLE IF NOT EXISTS groups (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by VARCHAR(50) NOT NULL,
    created_at BIGINT NOT NULL,
    settings JSONB DEFAULT '{}'
);

-- Создание таблицы участников групп
CREATE TABLE IF NOT EXISTS group_members (
    group_id VARCHAR(50) REFERENCES groups(id) ON DELETE CASCADE,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    joined_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    PRIMARY KEY (group_id, user_id)
);

-- Создание таблицы опросов
CREATE TABLE IF NOT EXISTS polls (
    id VARCHAR(50) PRIMARY KEY,
    group_id VARCHAR(50) REFERENCES groups(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    is_multiple_choice BOOLEAN DEFAULT false,
    is_anonymous BOOLEAN DEFAULT false,
    expires_at TIMESTAMP,
    created_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Создание таблицы голосов в опросах
CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id VARCHAR(50) REFERENCES polls(id) ON DELETE CASCADE,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    option_index INTEGER NOT NULL,
    voted_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (poll_id, user_id)
);

-- Создаем тестовые данные
INSERT INTO users (user_id, username, email, display_name, status) VALUES 
('user_1', 'test', 'test@test.com', 'Тестовый пользователь', 'online'),
('user_2', 'user2', 'user2@test.com', 'Второй пользователь', 'online'),
('user_3', 'user3', 'user3@test.com', 'Третий пользователь', 'online');

INSERT INTO groups (id, name, description, created_by, created_at) VALUES 
('group_1', 'Техническая поддержка', 'Группа для вопросов по технической поддержке', 'user_1', 1700000000000),
('group_2', 'Разработчики', 'Обсуждение разработки приложения', 'user_2', 1700000000000);

INSERT INTO group_members (group_id, user_id, role) VALUES 
('group_1', 'user_1', 'admin'),
('group_1', 'user_2', 'member'),
('group_1', 'user_3', 'member'),
('group_2', 'user_2', 'admin'),
('group_2', 'user_1', 'member');

INSERT INTO chats (id, name, type, last_message, timestamp, created_by) VALUES
('chat_1', 'Общий чат', 'group', 'Добро пожаловать!', 1700000000000, 'user_1'),
('chat_2', 'Личная переписка', 'private', 'Привет!', 1700000000000, 'user_1');

INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) VALUES
('msg_1', 'chat_1', 'Добро пожаловать в чат!', 'user_1', 'Тестовый пользователь', 1700000000000, 'text'),
('msg_2', 'chat_1', 'Привет всем!', 'user_2', 'Второй пользователь', 1700000001000, 'text');
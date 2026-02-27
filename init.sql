-- Создание таблицы пользователей
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    status VARCHAR(20) DEFAULT 'offline',
    custom_status VARCHAR(255) DEFAULT 'В сети',
    last_seen BIGINT,
    profile_image TEXT,
    phone_number VARCHAR(20),
    bio TEXT,
    birthday VARCHAR(50), 
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- Добавление остальных колонок
ALTER TABLE users ADD COLUMN IF NOT EXISTS message_notifications BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS call_notifications BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_sound BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS online_status BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS read_receipts BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings_updated_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS calls (
    id VARCHAR(50) PRIMARY KEY,
    from_user_id VARCHAR(50) NOT NULL,
    to_user_id VARCHAR(50) NOT NULL,
    call_type VARCHAR(20) DEFAULT 'voice',
    status VARCHAR(20) DEFAULT 'initiated',
    duration INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP
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

-- 🆕 ТАБЛИЦЫ ДЛЯ МОДЕРАЦИИ

-- Роли пользователей
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_expires BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS warnings INTEGER DEFAULT 0;

-- Жалобы
CREATE TABLE IF NOT EXISTS reports (
    id VARCHAR(50) PRIMARY KEY,
    reporter_id VARCHAR(50) REFERENCES users(user_id),
    reported_user_id VARCHAR(50) REFERENCES users(user_id),
    reported_message_id VARCHAR(50),
    reason TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'pending',
    assigned_moderator_id VARCHAR(50) REFERENCES users(user_id),
    is_premium BOOLEAN DEFAULT false,
    escalation_level INTEGER DEFAULT 0,
    resolution TEXT,
    resolved_at BIGINT,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- Действия модерации
CREATE TABLE IF NOT EXISTS moderation_actions (
    id VARCHAR(50) PRIMARY KEY,
    moderator_id VARCHAR(50) REFERENCES users(user_id),
    target_user_id VARCHAR(50) REFERENCES users(user_id),
    action_type VARCHAR(50) NOT NULL,
    reason TEXT,
    duration BIGINT, -- для временных банов
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- Шаблонные ответы
CREATE TABLE IF NOT EXISTS template_responses (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50),
    created_by VARCHAR(50) REFERENCES users(user_id),
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- Аудит действий
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(user_id),
    action VARCHAR(255) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(50),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

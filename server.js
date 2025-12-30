require('dotenv').config({ path: '.env' });

console.log('🚀 ===== ЗАПУСК СЕРВЕРА =====');
console.log('🔑 JWT_SECRET загружен?', !!process.env.JWT_SECRET);
console.log('📡 PORT:', process.env.PORT || 10000);

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const http = require('http');
const jwt = require('jsonwebtoken');

// Импорт контроллеров и роутов
const authController = require('./src/controllers/authController');
const authRoutes = require('./src/routes/auth');
const chatRoutes = require('./src/routes/chat');
const callRoutes = require('./src/routes/call');
const messageRoutes = require('./src/routes/message');
const securityRoutes = require('./src/routes/security');
const usernameRoutes = require('./src/routes/username');
const moderationRoutes = require('./src/routes/moderation');
const reportRoutes = require('./src/routes/reports');
const templateRoutes = require('./src/routes/templates');
const dashboardRoutes = require('./src/routes/dashboard');

const authMiddleware = require('./src/middleware/authMiddleware');

const app = express();
const server = http.createServer(app);

// Socket.io конфигурация
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const port = process.env.PORT || 10000;

// Глобальные переменные для хранения подключений
const connectedUsers = new Map(); // userId -> socket.id
const userSockets = new Map(); // userId -> Set(socket.id)
const chatRooms = new Map(); // chatId -> Set(userId)

// Middleware
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Логирование запросов
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`📨 [${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

// Функция для безопасного разбора chatId
function extractParticipantIds(chatId) {
  try {
    console.log(`🔍 Извлечение участников из chatId: ${chatId}`);
    
    if (!chatId || typeof chatId !== 'string') {
      console.error('❌ Неверный формат chatId:', chatId);
      return [];
    }
    
    // Удаляем префикс "user_" если есть
    const cleanChatId = chatId.replace(/user_/g, '');
    
    // Разделяем по "_"
    const parts = cleanChatId.split('_');
    
    if (parts.length < 2) {
      console.error(`❌ Неверный формат chatId: ${chatId}, parts: ${parts}`);
      return [];
    }
    
    // Берем первые два числа как ID участников
    const participant1 = parts[0].trim();
    const participant2 = parts[1].trim();
    
    if (!participant1 || !participant2) {
      console.error(`❌ Пустые ID участников в chatId: ${chatId}`);
      return [];
    }
    
    console.log(`🔍 Участники: ${participant1}, ${participant2}`);
    return [participant1, participant2];
    
  } catch (error) {
    console.error(`❌ Ошибка разбора chatId ${chatId}:`, error);
    return [];
  }
}

// Функция для создания chatId
function createChatId(userId1, userId2) {
  // Убеждаемся, что это только числовые ID
  const id1 = String(userId1).replace(/\D/g, '');
  const id2 = String(userId2).replace(/\D/g, '');
  
  // Сортируем ID для единообразия
  const sortedIds = [id1, id2].sort((a, b) => a.localeCompare(b));
  
  // Формируем chatId: user_123456_user_789012
  const chatId = `user_${sortedIds[0]}_user_${sortedIds[1]}`;
  console.log(`🔧 Создан chatId: ${chatId} для пользователей ${id1} и ${id2}`);
  return chatId;
}

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

// Инициализация базы данных
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Инициализация базы данных...');
    
    // Таблица пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        display_name TEXT NOT NULL,
        phone TEXT UNIQUE,
        password TEXT,
        status TEXT DEFAULT 'offline',
        last_seen BIGINT,
        role VARCHAR(20) DEFAULT 'user',
        is_premium BOOLEAN DEFAULT false,
        is_banned BOOLEAN DEFAULT false,
        ban_expires BIGINT,
        warnings INTEGER DEFAULT 0,
        auth_level VARCHAR(50) DEFAULT 'sms_only',
        bio TEXT,
        profile_image TEXT,
        custom_status VARCHAR(255) DEFAULT 'В сети',
        message_notifications BOOLEAN DEFAULT true,
        call_notifications BOOLEAN DEFAULT true,
        notification_sound BOOLEAN DEFAULT true,
        online_status BOOLEAN DEFAULT true,
        read_receipts BOOLEAN DEFAULT true,
        settings_updated_at TIMESTAMP,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        updated_at BIGINT
      )
    `);
    
    // Таблица безопасности
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_security (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) UNIQUE NOT NULL,
        two_fa_enabled BOOLEAN DEFAULT false,
        two_fa_secret TEXT,
        two_fa_setup_at BIGINT,
        two_fa_attempts INTEGER DEFAULT 0,
        two_fa_locked_until BIGINT,
        code_word_enabled BOOLEAN DEFAULT false,
        code_word_hash TEXT,
        code_word_hint VARCHAR(100),
        code_word_set_at BIGINT,
        code_word_attempts INTEGER DEFAULT 0,
        code_word_locked_until BIGINT,
        additional_passwords JSONB DEFAULT '[]',
        security_level VARCHAR(20) DEFAULT 'low',
        last_security_update BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        trusted_devices JSONB DEFAULT '[]'
      )
    `);
    
    // Таблица кодов верификации
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        id VARCHAR(50) PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        code VARCHAR(10) NOT NULL,
        type VARCHAR(20) DEFAULT 'sms',
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        is_used BOOLEAN DEFAULT false,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица чатов
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'private',
        timestamp BIGINT,
        last_message TEXT,
        last_message_time BIGINT,
        unread_count INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    
    // Таблица сообщений
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        text TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        timestamp BIGINT,
        type TEXT DEFAULT 'text',
        read BOOLEAN DEFAULT false,
        read_by JSONB DEFAULT '[]',
        delivered_to JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'sent'
      )
    `);
    
    // Таблица групп
    await client.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_by TEXT NOT NULL,
        created_at BIGINT,
        avatar_url TEXT,
        is_public BOOLEAN DEFAULT false,
        member_count INTEGER DEFAULT 1
      )
    `);
    
    // Таблица участников групп
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        PRIMARY KEY (group_id, user_id)
      )
    `);
    
    // Таблица звонков
    await client.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        call_type TEXT DEFAULT 'voice',
        status TEXT DEFAULT 'initiated',
        duration INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        ended_at BIGINT,
        peer_id TEXT
      )
    `);
    
    // Таблица уведомлений
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        body TEXT,
        data JSONB,
        is_read BOOLEAN DEFAULT false,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    
    // Таблица жалоб
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id VARCHAR(50) PRIMARY KEY,
        reporter_id VARCHAR(50),
        reported_user_id VARCHAR(50),
        reported_message_id VARCHAR(50),
        reason TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'pending',
        assigned_moderator_id VARCHAR(50),
        is_premium BOOLEAN DEFAULT false,
        escalation_level INTEGER DEFAULT 0,
        resolution TEXT,
        resolved_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    
    // Таблица действий модерации
    await client.query(`
      CREATE TABLE IF NOT EXISTS moderation_actions (
        id VARCHAR(50) PRIMARY KEY,
        moderator_id VARCHAR(50),
        target_user_id VARCHAR(50),
        action_type VARCHAR(50) NOT NULL,
        reason TEXT,
        duration BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    
    // Таблица шаблонных ответов
    await client.query(`
      CREATE TABLE IF NOT EXISTS template_responses (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(50),
        created_by VARCHAR(50),
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    
    // Таблица аудит логов
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50),
        action VARCHAR(255) NOT NULL,
        target_type VARCHAR(50),
        target_id VARCHAR(50),
        details JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    
    // Создание индексов
    await client.query('CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chats_timestamp ON chats(timestamp DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority DESC)');
    
    console.log('✅ Все таблицы базы данных созданы/проверены');
    
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Socket.io обработка подключений
io.on('connection', (socket) => {
  console.log(`🔗 Новое Socket.io подключение: ${socket.id}`);
  
  let userId = null;
  let userData = null;
  
  // Аутентификация через токен
  socket.on('authenticate', async (token) => {
    try {
      if (!token) {
        socket.emit('auth_error', { message: 'Токен отсутствует' });
        return;
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
      
      if (!userId) {
        socket.emit('auth_error', { message: 'Неверный токен' });
        return;
      }
      
      // Получаем данные пользователя
      const result = await pool.query(
        'SELECT user_id, username, display_name, role, status FROM users WHERE user_id = $1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        socket.emit('auth_error', { message: 'Пользователь не найден' });
        return;
      }
      
      userData = result.rows[0];
      socket.userId = userId;
      socket.userData = userData;
      
      // Сохраняем подключение
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);
      connectedUsers.set(socket.id, userId);
      
      // Обновляем статус пользователя
      await pool.query(
        'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
        ['online', Date.now(), userId]
      );
      
      // Уведомляем о подключении
      socket.emit('authenticated', {
        userId,
        username: userData.username,
        displayName: userData.display_name,
        timestamp: Date.now()
      });
      
      // Уведомляем других пользователей
      socket.broadcast.emit('user_online', {
        userId,
        username: userData.username
      });
      
      console.log(`✅ Пользователь аутентифицирован: ${userId} (${userData.display_name})`);
      
      // Загружаем и подписываем на чаты пользователя
      await loadAndSubscribeToChats(userId, socket);
      
    } catch (error) {
      console.error('❌ Ошибка аутентификации:', error.message);
      socket.emit('auth_error', { message: 'Ошибка аутентификации' });
    }
  });
  
  // Подключение к чату
  socket.on('join_chat', async (chatId) => {
    try {
      if (!userId || !chatId) {
        return;
      }
      
      console.log(`👥 Пользователь ${userId} присоединяется к чату: ${chatId}`);
      
      // Проверяем доступ к чату
      const participants = extractParticipantIds(chatId);
      if (!participants.includes(userId)) {
        socket.emit('chat_error', { chatId, error: 'Нет доступа к чату' });
        return;
      }
      
      socket.join(chatId);
      
      // Добавляем в комнаты чата
      if (!chatRooms.has(chatId)) {
        chatRooms.set(chatId, new Set());
      }
      chatRooms.get(chatId).add(userId);
      
      socket.emit('chat_joined', {
        chatId,
        timestamp: Date.now()
      });
      
      console.log(`✅ Пользователь ${userId} присоединился к чату ${chatId}`);
      
    } catch (error) {
      console.error('❌ Ошибка присоединения к чату:', error);
    }
  });
  
  // Покинуть чат
  socket.on('leave_chat', (chatId) => {
    if (!userId || !chatId) return;
    
    socket.leave(chatId);
    
    if (chatRooms.has(chatId)) {
      chatRooms.get(chatId).delete(userId);
      if (chatRooms.get(chatId).size === 0) {
        chatRooms.delete(chatId);
      }
    }
    
    console.log(`👥 Пользователь ${userId} покинул чат ${chatId}`);
  });
  
  // Отправка сообщения (WebSocket)
  socket.on('send_message', async (messageData) => {
    try {
      console.log('🔥 === ОТПРАВКА СООБЩЕНИЯ ЧЕРЕЗ WS ===');
      
      const { chatId, text, senderId, senderName, type = 'text' } = messageData;
      
      if (!chatId || !text || !senderId || !senderName) {
        socket.emit('message_error', { error: 'Отсутствуют обязательные поля' });
        return;
      }
      
      if (userId !== senderId) {
        socket.emit('message_error', { error: 'Несоответствие ID отправителя' });
        return;
      }
      
      console.log(`📤 Отправка сообщения в ${chatId} от ${senderId}: ${text.substring(0, 50)}...`);
      
      // Проверяем участников чата
      const participants = extractParticipantIds(chatId);
      if (participants.length === 0) {
        socket.emit('message_error', { error: 'Неверный формат chatId' });
        return;
      }
      
      if (!participants.includes(senderId)) {
        socket.emit('message_error', { error: 'Отправитель не является участником чата' });
        return;
      }
      
      const receiverId = participants.find(id => id !== senderId);
      if (!receiverId) {
        socket.emit('message_error', { error: 'Не найден получатель' });
        return;
      }
      
      // Сохраняем сообщение в БД
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const timestamp = Date.now();
      
      await pool.query(
        `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [messageId, chatId, text, senderId, senderName, timestamp, type, 'delivered']
      );
      
      // Обновляем или создаем чат
      const chatCheck = await pool.query(
        'SELECT id, name FROM chats WHERE id = $1',
        [chatId]
      );
      
      if (chatCheck.rows.length === 0) {
        // Получаем имя получателя для названия чата
        const userResult = await pool.query(
          'SELECT display_name FROM users WHERE user_id = $1',
          [receiverId]
        );
        
        const chatName = userResult.rows.length > 0 
          ? userResult.rows[0].display_name 
          : `User ${receiverId.slice(-4)}`;
        
        await pool.query(
          `INSERT INTO chats (id, name, type, timestamp, last_message, last_message_time) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [chatId, chatName, 'private', timestamp, text, timestamp]
        );
        
        console.log(`✅ Чат создан: ${chatId} (${chatName})`);
      } else {
        await pool.query(
          `UPDATE chats SET timestamp = $1, last_message = $2, last_message_time = $3 WHERE id = $4`,
          [timestamp, text, timestamp, chatId]
        );
        
        console.log(`🔄 Чат обновлен: ${chatId}`);
      }
      
      // Формируем объект сообщения для отправки
      const message = {
        id: messageId,
        chat_id: chatId,
        text: text,
        sender_id: senderId,
        sender_name: senderName,
        type: type,
        timestamp: timestamp,
        status: 'delivered'
      };
      
      // 🔥 КРИТИЧЕСКИЙ МОМЕНТ: Отправляем сообщение
      
      // 1. Отправляем отправителю (подтверждение)
      socket.emit('message_sent', {
        messageId,
        chatId,
        status: 'sent',
        timestamp
      });
      
      // 2. Отправляем в комнату чата
      socket.to(chatId).emit('new_message', message);
      
      // 3. Находим сокеты получателя и отправляем напрямую
      const receiverSockets = userSockets.get(receiverId);
      if (receiverSockets && receiverSockets.size > 0) {
        receiverSockets.forEach(socketId => {
          io.to(socketId).emit('new_message', message);
        });
        console.log(`✅ Сообщение отправлено получателю ${receiverId} через ${receiverSockets.size} соединений`);
      } else {
        console.log(`⚠️ Получатель ${receiverId} оффлайн, сообщение сохранено`);
        
        // Сохраняем уведомление для оффлайн пользователя
        await pool.query(
          `INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`notif_${Date.now()}`, receiverId, 'new_message', 
           'Новое сообщение', `${senderName}: ${text.substring(0, 100)}`, 
           JSON.stringify({ chatId, messageId, senderId }), timestamp]
        );
      }
      
      // 4. Уведомляем об обновлении чата
      participants.forEach(participantId => {
        const participantSockets = userSockets.get(participantId);
        if (participantSockets) {
          participantSockets.forEach(socketId => {
            io.to(socketId).emit('chat_updated', {
              chatId,
              lastMessage: text,
              lastMessageTime: timestamp,
              unreadCount: participantId === receiverId ? 1 : 0
            });
          });
        }
      });
      
      console.log(`✅ Сообщение ${messageId} успешно доставлено в чат ${chatId}`);
      
    } catch (error) {
      console.error('❌ Ошибка отправки сообщения через WS:', error);
      socket.emit('message_error', { error: error.message });
    }
  });
  
  // Сообщение прочитано
  socket.on('message_read', async (data) => {
    try {
      const { messageId, chatId, readerId } = data;
      
      if (!messageId || !chatId || !readerId) {
        return;
      }
      
      // Обновляем статус прочтения в БД
      await pool.query(
        `UPDATE messages 
         SET read = true, 
             read_by = COALESCE(read_by, '[]'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify([readerId]), messageId]
      );
      
      // Получаем отправителя сообщения
      const messageResult = await pool.query(
        'SELECT sender_id FROM messages WHERE id = $1',
        [messageId]
      );
      
      if (messageResult.rows.length > 0) {
        const senderId = messageResult.rows[0].sender_id;
        
        // Уведомляем отправителя о прочтении
        if (senderId !== readerId && userSockets.has(senderId)) {
          userSockets.get(senderId).forEach(socketId => {
            io.to(socketId).emit('message_read', {
              messageId,
              chatId,
              readerId,
              timestamp: Date.now()
            });
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Ошибка отметки сообщения как прочитанного:', error);
    }
  });
  
  // Набор текста
  socket.on('typing', (data) => {
    const { chatId, isTyping } = data;
    
    if (!chatId || !userId) return;
    
    // Отправляем всем в чате, кроме себя
    socket.to(chatId).emit('user_typing', {
      chatId,
      userId,
      isTyping,
      timestamp: Date.now()
    });
  });
  
  // Звонки
  socket.on('start_call', async (callData) => {
    try {
      const { toUserId, callType = 'voice', peerId } = callData;
      
      if (!toUserId || !userId) {
        socket.emit('call_error', { error: 'Отсутствуют обязательные данные' });
        return;
      }
      
      console.log(`📞 Звонок от ${userId} к ${toUserId}`);
      
      const callId = `call_${Date.now()}`;
      
      // Сохраняем звонок в БД
      await pool.query(
        `INSERT INTO calls (id, from_user_id, to_user_id, call_type, status, peer_id, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [callId, userId, toUserId, callType, 'ringing', peerId, Date.now()]
      );
      
      // Отправляем уведомление получателю
      const receiverSockets = userSockets.get(toUserId);
      if (receiverSockets && receiverSockets.size > 0) {
        // Получаем данные отправителя
        const senderResult = await pool.query(
          'SELECT display_name, profile_image FROM users WHERE user_id = $1',
          [userId]
        );
        
        const senderData = senderResult.rows[0] || { display_name: 'Пользователь' };
        
        receiverSockets.forEach(socketId => {
          io.to(socketId).emit('incoming_call', {
            callId,
            fromUserId: userId,
            fromUserName: senderData.display_name,
            fromUserAvatar: senderData.profile_image,
            callType,
            peerId,
            timestamp: Date.now()
          });
        });
        
        socket.emit('call_started', {
          callId,
          status: 'ringing'
        });
        
        console.log(`✅ Уведомление о звонке отправлено ${toUserId}`);
      } else {
        socket.emit('call_error', { error: 'Пользователь оффлайн' });
      }
      
    } catch (error) {
      console.error('❌ Ошибка начала звонка:', error);
      socket.emit('call_error', { error: error.message });
    }
  });
  
  socket.on('accept_call', async (callData) => {
    try {
      const { callId } = callData;
      
      console.log(`✅ Принятие звонка: ${callId}`);
      
      const callResult = await pool.query(
        'SELECT from_user_id, to_user_id FROM calls WHERE id = $1',
        [callId]
      );
      
      if (callResult.rows.length === 0) {
        socket.emit('call_error', { error: 'Звонок не найден' });
        return;
      }
      
      const call = callResult.rows[0];
      
      // Обновляем статус звонка
      await pool.query(
        'UPDATE calls SET status = $1 WHERE id = $2',
        ['active', callId]
      );
      
      // Уведомляем инициатора
      const callerSockets = userSockets.get(call.from_user_id);
      if (callerSockets) {
        callerSockets.forEach(socketId => {
          io.to(socketId).emit('call_accepted', {
            callId,
            timestamp: Date.now()
          });
        });
      }
      
      console.log(`✅ Звонок ${callId} принят`);
      
    } catch (error) {
      console.error('❌ Ошибка принятия звонка:', error);
      socket.emit('call_error', { error: error.message });
    }
  });
  
  socket.on('reject_call', async (callData) => {
    try {
      const { callId } = callData;
      
      console.log(`❌ Отклонение звонка: ${callId}`);
      
      const callResult = await pool.query(
        'SELECT from_user_id FROM calls WHERE id = $1',
        [callId]
      );
      
      if (callResult.rows.length === 0) return;
      
      const call = callResult.rows[0];
      
      // Обновляем статус звонка
      await pool.query(
        'UPDATE calls SET status = $1 WHERE id = $2',
        ['rejected', callId]
      );
      
      // Уведомляем инициатора
      const callerSockets = userSockets.get(call.from_user_id);
      if (callerSockets) {
        callerSockets.forEach(socketId => {
          io.to(socketId).emit('call_rejected', {
            callId,
            timestamp: Date.now()
          });
        });
      }
      
    } catch (error) {
      console.error('❌ Ошибка отклонения звонка:', error);
    }
  });
  
  socket.on('end_call', async (callData) => {
    try {
      const { callId, duration = 0 } = callData;
      
      console.log(`📞 Завершение звонка: ${callId}, длительность: ${duration}s`);
      
      const callResult = await pool.query(
        'SELECT from_user_id, to_user_id FROM calls WHERE id = $1',
        [callId]
      );
      
      if (callResult.rows.length === 0) return;
      
      const call = callResult.rows[0];
      
      // Обновляем звонок
      await pool.query(
        'UPDATE calls SET status = $1, duration = $2, ended_at = $3 WHERE id = $4',
        ['ended', duration, Date.now(), callId]
      );
      
      // Уведомляем участников
      const participants = [call.from_user_id, call.to_user_id];
      participants.forEach(participantId => {
        const participantSockets = userSockets.get(participantId);
        if (participantSockets) {
          participantSockets.forEach(socketId => {
            io.to(socketId).emit('call_ended', {
              callId,
              duration,
              timestamp: Date.now()
            });
          });
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка завершения звонка:', error);
    }
  });
  
  // WebRTC сигналинг
  socket.on('webrtc_offer', (data) => {
    const { targetUserId, offer, callId } = data;
    const targetSockets = userSockets.get(targetUserId);
    
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('webrtc_offer', {
          offer,
          callId,
          fromUserId: userId
        });
      });
    }
  });
  
  socket.on('webrtc_answer', (data) => {
    const { targetUserId, answer, callId } = data;
    const targetSockets = userSockets.get(targetUserId);
    
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('webrtc_answer', {
          answer,
          callId
        });
      });
    }
  });
  
  socket.on('webrtc_ice_candidate', (data) => {
    const { targetUserId, candidate, callId } = data;
    const targetSockets = userSockets.get(targetUserId);
    
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('webrtc_ice_candidate', {
          candidate,
          callId
        });
      });
    }
  });
  
  // Модерация
  socket.on('join_moderation_queue', (data) => {
    const { userId: modUserId, role } = data;
    
    if (['moderator', 'admin', 'lead', 'super_admin'].includes(role)) {
      socket.join('moderation_queue');
      socket.emit('queue_joined', { queue: 'moderation' });
      console.log(`👮 Модератор ${modUserId} присоединился к очереди`);
    }
  });
  
  socket.on('subscribe_reports', (data) => {
    const { userId: modUserId, role } = data;
    
    if (['moderator', 'admin', 'lead', 'super_admin'].includes(role)) {
      socket.join('report_notifications');
      console.log(`🔔 Модератор ${modUserId} подписался на уведомления`);
    }
  });
  
  // Ping/Pong для поддержания соединения
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });
  
  // Отключение
  socket.on('disconnect', async () => {
    console.log(`🔌 Отключение: ${socket.id} (пользователь: ${userId || 'не аутентифицирован'})`);
    
    if (userId) {
      // Удаляем из списков подключений
      if (userSockets.has(userId)) {
        userSockets.get(userId).delete(socket.id);
        if (userSockets.get(userId).size === 0) {
          userSockets.delete(userId);
          
          // Обновляем статус пользователя
          await pool.query(
            'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
            ['offline', Date.now(), userId]
          );
          
          // Уведомляем о выходе из сети
          socket.broadcast.emit('user_offline', {
            userId,
            timestamp: Date.now()
          });
          
          console.log(`👤 Пользователь ${userId} полностью отключился`);
        }
      }
      
      // Удаляем из connectedUsers
      connectedUsers.delete(socket.id);
    }
  });
  
  socket.on('error', (error) => {
    console.error(`❌ Ошибка сокета ${socket.id}:`, error);
  });
});

// Функция для загрузки и подписки на чаты пользователя
async function loadAndSubscribeToChats(userId, socket) {
  try {
    // Находим все чаты пользователя
    const result = await pool.query(
      `SELECT id FROM chats 
       WHERE id LIKE $1 OR id LIKE $2 OR id LIKE $3`,
      [`%${userId}%`, `user_${userId}_%`, `%_user_${userId}`]
    );
    
    const userChats = result.rows.map(row => row.id);
    
    console.log(`📋 Пользователь ${userId} состоит в ${userChats.length} чатах`);
    
    // Подписываем на каждый чат
    userChats.forEach(chatId => {
      socket.join(chatId);
      
      // Добавляем в комнаты чата
      if (!chatRooms.has(chatId)) {
        chatRooms.set(chatId, new Set());
      }
      chatRooms.get(chatId).add(userId);
    });
    
  } catch (error) {
    console.error(`❌ Ошибка загрузки чатов для ${userId}:`, error);
  }
}

// Подключаем роуты
app.use('/api/auth', authRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/username', usernameRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/call', callRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 🔒 ЗАЩИЩЕННЫЕ РОУТЫ
app.use('/api/chat', authMiddleware.authenticate, chatRoutes);
app.use('/api/call', authMiddleware.authenticate, callRoutes);
app.use('/api/message', authMiddleware.authenticate, messageRoutes);

// Основные эндпоинты

// Корневой эндпоинт
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Messenger Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    socketStatus: 'active',
    connectedUsers: connectedUsers.size,
    activeChats: chatRooms.size,
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      chats: '/api/chats',
      messages: '/api/messages',
      calls: '/api/calls',
      moderation: '/api/moderation',
      security: '/api/security'
    }
  });
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      database: 'connected',
      socketIo: 'active',
      connectedUsers: connectedUsers.size,
      activeChats: chatRooms.size,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Статистика WebSocket
app.get('/api/ws/stats', (req, res) => {
  const stats = {
    connectedUsers: connectedUsers.size,
    userSockets: Array.from(userSockets.entries()).map(([userId, sockets]) => ({
      userId,
      socketCount: sockets.size
    })),
    chatRooms: Array.from(chatRooms.entries()).map(([chatId, users]) => ({
      chatId,
      userCount: users.size,
      users: Array.from(users)
    })),
    totalSockets: io.engine.clientsCount
  };
  
  res.json(stats);
});

// Создать chatId для двух пользователей
app.get('/api/chat/create-id', (req, res) => {
  const { userId1, userId2 } = req.query;
  
  if (!userId1 || !userId2) {
    return res.status(400).json({ error: 'Необходимы оба userId' });
  }
  
  const chatId = createChatId(userId1, userId2);
  
  res.json({
    chatId,
    participants: extractParticipantIds(chatId)
  });
});

// Проверить доставку сообщения
app.get('/api/message/delivery/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM messages WHERE id = $1',
      [messageId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }
    
    const message = result.rows[0];
    const participants = extractParticipantIds(message.chat_id);
    
    const deliveryStatus = {
      messageId: message.id,
      chatId: message.chat_id,
      senderId: message.sender_id,
      status: message.status,
      timestamp: message.timestamp,
      participants,
      onlineParticipants: participants.filter(id => userSockets.has(id)),
      offlineParticipants: participants.filter(id => !userSockets.has(id))
    };
    
    res.json(deliveryStatus);
    
  } catch (error) {
    console.error('❌ Ошибка проверки доставки:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обработка 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Эндпоинт не найден',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Глобальный обработчик ошибок
app.use((error, req, res, next) => {
  console.error('🔥 Глобальная ошибка:', error);
  
  res.status(500).json({
    error: 'Внутренняя ошибка сервера',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// Очистка при завершении
process.on('SIGINT', async () => {
  console.log('\n🔻 Завершение работы сервера...');
  
  // Обновляем статусы всех онлайн пользователей
  for (const [userId] of userSockets) {
    try {
      await pool.query(
        'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
        ['offline', Date.now(), userId]
      );
    } catch (error) {
      console.error(`❌ Ошибка обновления статуса ${userId}:`, error);
    }
  }
  
  console.log('✅ Статусы пользователей обновлены');
  process.exit(0);
});

// Запуск сервера
async function startServer() {
  try {
    // Инициализируем базу данных
    await initializeDatabase();
    console.log('✅ База данных готова');
    
    // Запускаем сервер
    server.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Сервер запущен на порту ${port}`);
      console.log(`🔗 HTTP: http://localhost:${port}`);
      console.log(`🔗 WebSocket: ws://localhost:${port}`);
      console.log(`🔗 Health check: http://localhost:${port}/health`);
      console.log(`🔗 WebSocket stats: http://localhost:${port}/api/ws/stats`);
      console.log(`👥 Подключенные пользователи: 0`);
      console.log(`💬 Активные чаты: 0`);
      console.log('🚀 ======= СЕРВЕР ЗАПУЩЕН =======');
    });
    
  } catch (error) {
    console.error('❌ Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

startServer();
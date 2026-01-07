require('dotenv').config({ path: '.env' });

console.log('🚀 ===== ЗАПУСК СЕРВЕРА =====');
console.log('🔑 JWT_SECRET загружен?', !!process.env.JWT_SECRET);

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const http = require('http');
const authController = require('./src/controllers/authController');
const moderationRoutes = require('./src/routes/moderation');
const { initializeNotificationSocket } = require('./src/sockets/notificationSocket');
const NotificationService = require('./src/services/NotificationService');
const authMiddleware = require('./src/middleware/authMiddleware');

// 🔥 ПОДКЛЮЧАЕМ КОНТРОЛЛЕРЫ
const authRoutes = require('./src/routes/auth');
const db = require('./src/config/database');
const chatRoutes = require('./src/routes/chat');
const callRoutes = require('./src/routes/call');
const messageRoutes = require('./src/routes/message');

const sessionRoutes = require('./src/routes/session');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 30000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e6 // 1MB
});

// Инициализируем сервис уведомлений
const notificationService = new NotificationService(io);

// В обработчике WebSocket соединения:
io.on('connection', (socket) => {
  console.log('🔗 Пользователь подключился:', socket.id);

  // Регистрация устройства для уведомлений
  socket.on('register:device', (data) => {
    const { userId, deviceId } = data;
    if (userId && deviceId) {
      notificationService.registerDevice(userId, deviceId, socket.id);
      
      // Отправляем подтверждение
      socket.emit('device:registered', {
        success: true,
        deviceId,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Получение онлайн устройств
  socket.on('get:online:devices', (data) => {
    const { userId } = data;
    const onlineDevices = notificationService.getOnlineDevices(userId);
    
    socket.emit('online:devices', {
      userId,
      devices: onlineDevices,
      count: onlineDevices.length
    });
  });

  // Проверка связи
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  // Отключение
  socket.on('disconnect', () => {
    // Находим и удаляем устройство (нужно хранить mapping socketId -> {userId, deviceId})
    console.log('🔗 Пользователь отключился:', socket.id);
  });
});

// Экспортируем для использования в других модулях
module.exports = { io, notificationService };

const port = process.env.PORT || 10000;

// 🔥 ЗАГРУЗКА .env ФАЙЛА
require('dotenv').config();

// Глобальный обработчик ошибок
process.on('uncaughtException', (error) => {
  console.error('❌ НЕПОЙМАННАЯ ОШИБКА:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ НЕОБРАБОТАННЫЙ PROMISE:', reason);
});

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Логирование всех запросов
app.use((req, res, next) => {
    console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    console.log('🔍 Raw URL:', req.url);
    console.log('🔍 Query string:', req.query);
    console.log('📦 Body:', req.body);
    next();
});

// 🔥 ПОДКЛЮЧАЕМ РОУТЫ
app.use('/api/auth', authRoutes);
const securityRoutes = require('./src/routes/security');
app.use('/api/security', securityRoutes);
app.use('/api/security', require('./src/routes/security'));
app.use('/api/call', callRoutes);
app.use('/api/message', messageRoutes);
const usernameRoutes = require('./src/routes/username');
app.use('/api/username', usernameRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/session', sessionRoutes); 


// 🔒 ЗАЩИЩЕННЫЕ РОУТЫ (требуют авторизации)
app.use('/api/chat', authMiddleware.authenticate, chatRoutes);
app.use('/api/call', authMiddleware.authenticate, callRoutes);
app.use('/api/message', authMiddleware.authenticate, messageRoutes);
app.use('/api/username', authMiddleware.authenticate, usernameRoutes);

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

// Функция инициализации базы
async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database...');
    
    // Подключаемся к базе
    await db.connect();
    
    // 🔥 СОЗДАНИЕ ТАБЛИЦЫ ПОЛЬЗОВАТЕЛЕЙ 
    await db.query(`
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
            
            -- ДОБАВЛЕННЫЕ КОЛОНКИ ДЛЯ ПРОФИЛЯ:
            bio TEXT,
            profile_image TEXT,
            custom_status VARCHAR(255) DEFAULT 'В сети',
            
            -- ДОБАВЛЕННЫЕ КОЛОНКИ ДЛЯ НАСТРОЕК:
            message_notifications BOOLEAN DEFAULT true,
            call_notifications BOOLEAN DEFAULT true,
            notification_sound BOOLEAN DEFAULT true,
            online_status BOOLEAN DEFAULT true,
            read_receipts BOOLEAN DEFAULT true,
            settings_updated_at TIMESTAMP,
            
            -- ТАЙМСТАМПЫ:
            created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
            updated_at BIGINT
        )
    `);
    
  const alterColumns = [
      'bio TEXT',
      'profile_image TEXT',
      'custom_status VARCHAR(255) DEFAULT \'В сети\'',
      'message_notifications BOOLEAN DEFAULT true',
      'call_notifications BOOLEAN DEFAULT true',
      'notification_sound BOOLEAN DEFAULT true',
      'online_status BOOLEAN DEFAULT true',
      'read_receipts BOOLEAN DEFAULT true',
      'settings_updated_at TIMESTAMP',
      'created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000',
      'updated_at BIGINT'
  ];

  for (const column of alterColumns) {
      try {
          await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${column}`);
          console.log(`✅ Добавлена колонка: ${column.split(' ')[0]}`);
      } catch (error) {
          console.log(`⚠️  Колонка уже существует: ${column.split(' ')[0]}`);
      }
  }

    await db.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(100) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        device_id VARCHAR(255) NOT NULL,
        device_name VARCHAR(100) NOT NULL DEFAULT 'Unknown Device',
        os VARCHAR(50) NOT NULL DEFAULT 'Unknown',
        device_info JSONB DEFAULT '{}',
        session_token VARCHAR(500) NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        access_token_expires_at TIMESTAMP NOT NULL,
        refresh_token_expires_at TIMESTAMP NOT NULL,
        ip_address VARCHAR(45),
        location JSONB,
        last_active_at TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, device_id, is_active)
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions(session_token);
      CREATE INDEX IF NOT EXISTS idx_sessions_access_token ON sessions(access_token);
      CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token);
      CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(refresh_token_expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_device ON sessions(user_id, device_id);
    `);

    await db.query(`
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

    await db.query(`
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
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT DEFAULT 'private',
          timestamp BIGINT,
          last_message TEXT
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        text TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        timestamp BIGINT,
        type TEXT DEFAULT 'text'
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_by TEXT NOT NULL,
        created_at BIGINT
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        PRIMARY KEY (group_id, user_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        call_type TEXT DEFAULT 'voice',
        status TEXT DEFAULT 'initiated',
        duration INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        FOREIGN KEY (from_user_id) REFERENCES users(user_id),
        FOREIGN KEY (to_user_id) REFERENCES users(user_id)
      )
    `);

    await db.query(`
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

    console.log('🔄 Creating moderation tables...');
    
    await db.query(`
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
    
    await db.query(`
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
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS template_responses (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(50),
        created_by VARCHAR(50),
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    
    await db.query(`
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
    
    await db.query('CREATE INDEX IF NOT EXISTS idx_verification_codes_phone_expires ON verification_codes(phone, expires_at)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_user_security_user_id ON user_security(user_id)');

    console.log('✅ All database tables created/verified');
    
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    console.log('⚠️  Application will continue with limited functionality');
  }
}

// Хранилище подключенных пользователей
const connectedUsers = new Map();

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('🔗 Пользователь подключился:', socket.id);

  // Модератор присоединяется к очереди
  socket.on('join_moderation_queue', (userData) => {
      const { userId, role } = userData;
      
      if (['moderator', 'admin', 'lead', 'super_admin'].includes(role)) {
          socket.join('moderation_queue');
          console.log(`👮 Модератор ${userId} присоединился к очереди`);
          
          socket.emit('queue_joined', {
              message: 'Joined moderation queue',
              queue: 'moderation'
          });
          
          // Отправляем текущую статистику
          pool.query(`
              SELECT COUNT(*) as pending_count 
              FROM reports 
              WHERE status = 'pending'
          `).then(result => {
              socket.emit('queue_stats', {
                  pendingReports: parseInt(result.rows[0].pending_count)
              });
          }).catch(err => {
              console.error('❌ Error getting queue stats:', err);
          });
      }
  });
    
  // Модератор покидает очередь
  socket.on('leave_moderation_queue', (userId) => {
      socket.leave('moderation_queue');
      console.log(`👮 Модератор ${userId} покинул очередь`);
  });
  
  // Подписка на уведомления о новых жалобах
  socket.on('subscribe_reports', (userData) => {
      const { userId, role } = userData;
      
      if (['moderator', 'admin', 'lead', 'super_admin'].includes(role)) {
          socket.join('report_notifications');
          console.log(`🔔 Пользователь ${userId} подписался на уведомления о жалобах`);
      }
  });

  // 📞 Обработчики звонков
  socket.on('start_call', async (callData) => {
    try {
      const { fromUserId, toUserId, callType = 'voice' } = callData;
      
      console.log('📞 Starting call via WebSocket:', { fromUserId, toUserId, callType });

      // Проверяем существование пользователей
      const fromUser = await pool.query(
        'SELECT * FROM users WHERE user_id = $1',
        [fromUserId]
      );
      
      const toUser = await pool.query(
        'SELECT * FROM users WHERE user_id = $1',
        [toUserId]
      );

      if (fromUser.rows.length === 0 || toUser.rows.length === 0) {
        socket.emit('call_error', { error: 'Пользователь не найден' });
        return;
      }

      const callId = 'call_' + Date.now();
      
      // Сохраняем звонок в базу
      const result = await pool.query(
        `INSERT INTO calls (id, from_user_id, to_user_id, call_type, status, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [callId, fromUserId, toUserId, callType, 'ringing', new Date()]
      );

      const call = result.rows[0];
      
      // Отправляем уведомление целевому пользователю
      const targetSocketId = connectedUsers.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('incoming_call', {
          callId: call.id,
          fromUserId: call.from_user_id,
          fromUserName: fromUser.rows[0].display_name,
          callType: call.call_type
        });
      }

      // Отправляем подтверждение инициатору
      socket.emit('call_started', {
        callId: call.id,
        status: 'ringing'
      });

      console.log('✅ Call initiated:', callId);

    } catch (error) {
      console.error('❌ WebSocket call error:', error);
      socket.emit('call_error', { error: 'Ошибка начала звонка' });
    }
  });

  // 📞 Принять звонок
  socket.on('accept_call', async (callData) => {
    try {
      const { callId } = callData;
      
      console.log('✅ Accepting call:', callId);

      // Обновляем статус звонка
      const result = await pool.query(
        `UPDATE calls SET status = 'active' WHERE id = $1 RETURNING *`,
        [callId]
      );

      if (result.rows.length === 0) {
        socket.emit('call_error', { error: 'Звонок не найден' });
        return;
      }

      const call = result.rows[0];
      
      // Уведомляем обоих пользователей
      const fromSocketId = connectedUsers.get(call.from_user_id);
      const toSocketId = connectedUsers.get(call.to_user_id);
      
      if (fromSocketId) {
        io.to(fromSocketId).emit('call_accepted', { callId: call.id });
      }
      if (toSocketId) {
        io.to(toSocketId).emit('call_accepted', { callId: call.id });
      }

      console.log('✅ Call accepted:', callId);

    } catch (error) {
      console.error('❌ Accept call error:', error);
      socket.emit('call_error', { error: 'Ошибка принятия звонка' });
    }
  });

  // 📞 Отклонить звонок
  socket.on('reject_call', async (callData) => {
    try {
      const { callId } = callData;
      
      console.log('❌ Rejecting call:', callId);

      // Обновляем статус звонка
      const result = await pool.query(
        `UPDATE calls SET status = 'rejected' WHERE id = $1 RETURNING *`,
        [callId]
      );

      if (result.rows.length === 0) {
        socket.emit('call_error', { error: 'Звонок не найден' });
        return;
      }

      const call = result.rows[0];
      
      // Уведомляем инициатора
      const fromSocketId = connectedUsers.get(call.from_user_id);
      if (fromSocketId) {
        io.to(fromSocketId).emit('call_rejected', { callId: call.id });
      }

      console.log('✅ Call rejected:', callId);

    } catch (error) {
      console.error('❌ Reject call error:', error);
      socket.emit('call_error', { error: 'Ошибка отклонения звонка' });
    }
  });

  // 📞 Завершить звонок
  socket.on('end_call', async (callData) => {
    try {
      const { callId, duration = 0 } = callData;
      
      console.log('📞 Ending call:', { callId, duration });

      const result = await pool.query(
        `UPDATE calls 
        SET status = 'ended', duration = $1, ended_at = $2 
        WHERE id = $3 RETURNING *`,
        [duration, new Date(), callId]
      );

      if (result.rows.length === 0) {
        socket.emit('call_error', { error: 'Звонок не найден' });
        return;
      }

      const call = result.rows[0];
      
      // Уведомляем обоих пользователей
      const fromSocketId = connectedUsers.get(call.from_user_id);
      const toSocketId = connectedUsers.get(call.to_user_id);
      
      if (fromSocketId) {
        io.to(fromSocketId).emit('call_ended', { callId: call.id, duration });
      }
      if (toSocketId) {
        io.to(toSocketId).emit('call_ended', { callId: call.id, duration });
      }

      console.log('✅ Call ended:', callId);

    } catch (error) {
      console.error('❌ End call error:', error);
      socket.emit('call_error', { error: 'Ошибка завершения звонка' });
    }
  });

  // 🔄 WebRTC сигналинг для видео/аудио звонков
  socket.on('webrtc_offer', (data) => {
    const { targetUserId, offer, callId } = data;
    const targetSocketId = connectedUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_offer', { offer, callId, fromUserId: socket.userId });
    }
  });

  socket.on('webrtc_answer', (data) => {
    const { targetUserId, answer, callId } = data;
    const targetSocketId = connectedUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_answer', { answer, callId });
    }
  });

  socket.on('webrtc_ice_candidate', (data) => {
    const { targetUserId, candidate, callId } = data;
    const targetSocketId = connectedUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc_ice_candidate', { candidate, callId });
    }
  });

  socket.on('user_connected', (userId) => {
      // Храним с префиксом user_
      const fullUserId = `user_${userId}`;
      connectedUsers.set(fullUserId, socket.id);
      socket.userId = fullUserId;
      
      console.log(`👤 Пользователь ${fullUserId} подключен`);
      
      pool.query(
          'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
          ['online', Date.now(), userId]
      );
  });

  // Отправка сообщения через WebSocket
  socket.on('send_message', async (messageData) => {
    try {
      console.log('🔥 === НОВОЕ СООБЩЕНИЕ ===');
      
      const chatId = messageData.chat_id || messageData.chatId || '';
      const text = messageData.text || '';
      const senderId = messageData.sender_id || messageData.senderId || '';
      const senderName = messageData.sender_name || messageData.senderName || 'Вы';
      const type = messageData.type || 'text';
      
      console.log('🔥 Парсинг:', { chatId, text, senderId });

      if (!chatId || !text || !senderId) {
        socket.emit('message_error', { error: 'Missing required fields' });
        return;
      }

      // 🔥 ПРАВИЛЬНЫЙ РАЗБОР CHAT_ID
      const parts = chatId.split('_');
      
      if (parts.length < 4) {
        console.error('❌ Неверный chatId:', chatId);
        socket.emit('message_error', { error: 'Invalid chat ID' });
        return;
      }
      
      // Правильно получаем ID пользователей
      const user1 = parts[0] + '_' + parts[1];  // "user_1766839332356"
      const user2 = parts[2] + '_' + parts[3];  // "user_1766839575568"
      
      console.log('👥 Участники:', user1, user2);

      const messageId = 'msg_' + Date.now();
      const timestamp = Date.now();
      
      // 🔥 СОХРАНЯЕМ В БД
      await pool.query(
        `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, type, timestamp) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [messageId, chatId, text, senderId, senderName, type, timestamp]
      );
      console.log('✅ Сообщение сохранено:', messageId);

      // 🔥 СОЗДАЕМ/ОБНОВЛЯЕМ ЧАТ
      const chatCheck = await pool.query(
        'SELECT id FROM chats WHERE id = $1',
        [chatId]
      );
      
      if (chatCheck.rows.length === 0) {
        const otherUserId = senderId === user1 ? user2 : user1;
        let chatName = 'Приватный чат';
        
        const userResult = await pool.query(
          'SELECT display_name FROM users WHERE user_id = $1',
          [otherUserId]
        );
        
        if (userResult.rows.length > 0) {
          chatName = userResult.rows[0].display_name || `User ${otherUserId.slice(-4)}`;
        }
        
        await pool.query(
          `INSERT INTO chats (id, name, type, timestamp, last_message) 
          VALUES ($1, $2, $3, $4, $5)`,
          [chatId, chatName, 'private', timestamp, text]
        );
        console.log('✅ Чат создан:', chatId);
      } else {
        await pool.query(
          'UPDATE chats SET timestamp = $1, last_message = $2 WHERE id = $3',
          [timestamp, text, chatId]
        );
        console.log('✅ Чат обновлен:', chatId);
      }

  const messageToSend = {
          id: messageId,
          chat_id: chatId,
          text: text,
          sender_id: senderId,
          sender_name: senderName,
          type: type,
          timestamp: timestamp,
          status: 'DELIVERED'
      };

      // 🔥 1. ОТПРАВЛЯЕМ В КОМНАТУ ЧАТА
      socket.to(chatId).emit('new_message', messageToSend);

      // 🔥 2. ОТПРАВЛЯЕМ ПОЛУЧАТЕЛЮ НАПРЯМУЮ
      const receiverId = senderId === user1 ? user2 : user1;
      const receiverSocketId = connectedUsers.get(receiverId); // Ищем с префиксом

      if (receiverSocketId) {
          io.to(receiverSocketId).emit('new_message', messageToSend);
          console.log(`✅ Отправлено ${receiverId}`);
      } else {
          console.log(`⚠️ ${receiverId} оффлайн`);
          
          // Для уведомления используем чистый ID (без user_)
          const receiverCleanId = receiverId.replace('user_', '');
          await pool.query(
              `INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              ['notif_' + Date.now(), receiverCleanId, 'new_message',
              'Новое сообщение', `${senderName}: ${text}`, 
              JSON.stringify({ chatId, messageId }), timestamp]
          );
      }

      // 🔥 3. ПОДТВЕРЖДЕНИЕ ОТПРАВИТЕЛЮ
      socket.emit('message_sent', {
          messageId: messageId,
          chatId: chatId,
          status: 'SENT'
      });

    } catch (error) {
      console.error('❌ Ошибка:', error);
      socket.emit('message_error', { error: error.message });
    } 
  });

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`👥 Пользователь ${socket.userId} присоединился к чату ${chatId}`);
  });

  socket.on('leave_chat', (chatId) => {
    socket.leave(chatId);
    console.log(`👥 Пользователь ${socket.id} покинул чат ${chatId}`);
  });

  socket.on('disconnect', () => {
    // Находим и удаляем пользователя из connectedUsers
    for (let [userId, socketId] of connectedUsers.entries()) {
      if (socketId === socket.id) {
        connectedUsers.delete(userId);
        console.log(`👤 Пользователь ${userId} отключился`);
        
        // Обновляем статус в базе
        pool.query(
          'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
          ['offline', Date.now(), userId]
        ).catch(err => console.error('❌ Error updating user status:', err));
        
        // Уведомляем всех о offline пользователе
        socket.broadcast.emit('user_offline', userId);
        break;
      }
    }
  });
});

app.get('/api/users/phone/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        console.log('🔍 Searching user by phone:', phone);

        const result = await pool.query(
            'SELECT * FROM users WHERE phone = $1',
            [phone]
        );
        
        if (result.rows.length === 0) {
            console.log('❌ User not found for phone:', phone);
            return res.status(404).json({ 
                success: false,
                error: 'User not found' 
            });
        }
        
        const user = result.rows[0];
        console.log('✅ User found:', user.user_id);

        res.json({
            success: true,
            user: {
                id: user.user_id,
                username: user.username,
                displayName: user.display_name,
                phone: user.phone,
                role: user.role,
                status: user.status,
                is_premium: user.is_premium,
                authLevel: user.auth_level
            }
        });
        
    } catch (error) {
        console.error('❌ Error searching user by phone:', error);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error: ' + error.message 
        });
    }
});

// 👥 Пользователи
app.get('/api/users', async (req, res) => {
  console.log('📨 GET /api/users - Request received');
  
  try {
    console.log('🔍 Querying database...');
    const result = await pool.query('SELECT * FROM users');
    console.log(`✅ Found ${result.rows.length} users`);
    
    res.json({
      success: true,
      count: result.rows.length,
      users: result.rows
    });
    
  } catch (error) {
    console.error('❌ Database error in /api/users:', error);
    res.status(500).json({
      success: false,
      error: 'Database error: ' + error.message
    });
  }
});

// Эндпоинт статуса пользователя
app.get('/api/users/:userId/status', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Проверяем в connectedUsers
        const isOnline = connectedUsers.has(`user_${userId}`);
        
        // Получаем из базы
        const result = await pool.query(
            'SELECT last_seen FROM users WHERE user_id = $1',
            [userId]
        );
        
        let status = 'offline';
        if (isOnline) {
            status = 'online';
        } else if (result.rows.length > 0) {
            const lastSeen = result.rows[0].last_seen;
            const diff = Date.now() - (lastSeen || 0);
            
            if (diff < 300000) { // 5 минут
                status = 'recently';
            }
        }
        
        res.json({ userId, status, isOnline });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🔧 ЭНДПОИНТ ДЛЯ ПОИСКА ПОЛЬЗОВАТЕЛЯ ПО ТЕЛЕФОНУ
app.get('/api/moderation/user/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    console.log('🔍 Searching user by phone:', phone);

    // Форматируем номер в международный формат
    let formattedPhone = phone;
    if (!phone.startsWith('+')) {
      if (phone.startsWith('7') || phone.startsWith('8')) {
        formattedPhone = '+7' + phone.slice(1);
      } else if (phone.length === 10) {
        formattedPhone = '+7' + phone;
      }
    }

    console.log('📞 Formatted phone:', formattedPhone);

    const result = await pool.query(
      'SELECT user_id, username, display_name, phone, role, status, is_premium, auth_level FROM users WHERE phone = $1',
      [formattedPhone]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ User not found for phone:', formattedPhone);
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }
    
    const user = result.rows[0];
    console.log('✅ User found:', user.user_id);

    res.json({
      success: true,
      user: {
        id: user.user_id,
        username: user.username,
        displayName: user.display_name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        is_premium: user.is_premium,
        authLevel: user.auth_level
      }
    });
    
  } catch (error) {
    console.error('❌ Error in moderation user endpoint:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error: ' + error.message 
    });
  }
});

// ==================== 🤖 АВТОМАТИЧЕСКАЯ МОДЕРАЦИЯ ====================

// Функция автоматической проверки сообщений
function autoModerateMessage(text, senderId) {
    const violations = [];
    
    // Запрещенные слова
    const bannedWords = ['спам', 'мошенничество', 'взлом', 'обман', 'скам'];
    const foundBannedWords = bannedWords.filter(word => 
        text.toLowerCase().includes(word)
    );
    
    if (foundBannedWords.length > 0) {
        violations.push({
            type: 'banned_words',
            words: foundBannedWords,
            severity: 'high'
        });
    }
    
    // Проверка на спам (повторяющиеся символы/слова)
    const repeatedChars = /(.)\1{5,}/;
    const repeatedWords = /\b(\w+)\b.*\b\1\b.*\b\1\b/;
    
    if (repeatedChars.test(text) || repeatedWords.test(text)) {
        violations.push({
            type: 'spam',
            severity: 'medium'
        });
    }
    
    // Проверка на CAPS LOCK
    const capsRatio = (text.match(/[A-ZА-Я]/g) || []).length / text.length;
    if (capsRatio > 0.7 && text.length > 10) {
        violations.push({
            type: 'excessive_caps',
            severity: 'low'
        });
    }
    
    return violations;
}

app.post('/api/auth/login', authController.verifyCodeAndLogin);

// Эндпоинт для проверки сообщения
app.post('/api/moderation/scan-message', async (req, res) => {
    try {
        const { text, senderId } = req.body;
        
        console.log('🔍 Сканирование сообщения:', { text, senderId });
        
        const violations = autoModerateMessage(text, senderId);
        const shouldBlock = violations.some(v => v.severity === 'high');
        
        res.json({
            success: true,
            violations,
            shouldBlock,
            action: shouldBlock ? 'block' : 'allow',
            message: violations.length > 0 ? 'Найдены нарушения' : 'Сообщение чистое'
        });
        
    } catch (error) {
        console.error('❌ Ошибка сканирования сообщения:', error);
        res.status(500).json({ 
            success: false,
            error: 'Scan failed' 
        });
    }
});

// ==================== 📝 ШАБЛОННЫЕ ОТВЕТЫ ====================

// Получить шаблонные ответы
app.get('/api/moderation/templates', async (req, res) => {
    try {
        const { category } = req.query;
        
        let query = 'SELECT * FROM template_responses';
        let params = [];
        
        if (category) {
            query += ' WHERE category = $1';
            params.push(category);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            templates: result.rows
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения шаблонов:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get templates' 
        });
    }
});

app.get('/api/chat/my-chats', authMiddleware.authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const result = await pool.query(
            `SELECT c.*, 
                    (SELECT text FROM messages 
                     WHERE chat_id = c.id 
                     ORDER BY timestamp DESC 
                     LIMIT 1) as last_message,
                    (SELECT timestamp FROM messages 
                     WHERE chat_id = c.id 
                     ORDER BY timestamp DESC 
                     LIMIT 1) as last_message_time
             FROM chats c
             WHERE c.id LIKE $1 OR c.id LIKE $2 OR c.id LIKE $3
             ORDER BY last_message_time DESC NULLS LAST`,
            [`%${userId}%`, `user_${userId}_%`, `%_user_${userId}`]
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error loading chats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ТЕСТОВЫЙ ЭНДПОИНТ ДЛЯ ПРОВЕРКИ ТОКЕНА
app.get('/api/debug/token', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        
        console.log('🔍 === ДЕБАГ ТОКЕНА ===');
        console.log('📨 Заголовок:', authHeader);
        
        if (!authHeader) {
            return res.json({
                success: false,
                error: 'Нет заголовка Authorization',
                receivedHeaders: Object.keys(req.headers)
            });
        }
        
        let token;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else {
            token = authHeader;
        }
        
        console.log('🔑 Токен (первые 50 символов):', token.substring(0, 50) + '...');
        console.log('🔑 Длина токена:', token.length);
        
        // Декодируем без проверки
        const jwt = require('jsonwebtoken');
        let decoded;
        try {
            decoded = jwt.decode(token);
            console.log('📋 Декодированный токен:', decoded);
        } catch (error) {
            console.log('❌ Ошибка декодирования:', error.message);
        }
        
        // Проверяем подпись
        let verified = false;
        let verifyError = null;
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            verified = true;
            console.log('✅ Токен верифицирован');
        } catch (error) {
            verifyError = error.message;
            console.log('❌ Ошибка верификации:', error.message);
        }
        
        res.json({
            success: true,
            debug: {
                hasAuthHeader: !!authHeader,
                tokenLength: token.length,
                tokenStart: token.substring(0, 30) + '...',
                decoded: decoded,
                verified: verified,
                verifyError: verifyError,
                jwtSecretExists: !!process.env.JWT_SECRET,
                jwtSecretLength: process.env.JWT_SECRET?.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка дебага:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ТЕСТОВЫЙ ЭНДПОИНТ ДЛЯ ПРОВЕРКИ АУТЕНТИФИКАЦИИ
app.get('/api/debug/auth-test', authMiddleware.authenticate, (req, res) => {
    res.json({
        success: true,
        message: 'Аутентификация успешна!',
        user: req.user,
        timestamp: new Date().toISOString()
    });
});

// ==================== 🔍 ПОИСК ПОЛЬЗОВАТЕЛЕЙ ====================
app.get('/api/users/search', async (req, res) => {
    console.log('🎯 ОБРАБОТЧИК ПОИСКА ВЫЗВАН!');
    
    try {
        const query = req.query.query || '';
        console.log('🔍 Запрос:', query);
        
        if (!query || query.trim().length < 2) {
            return res.json({
                success: true,
                users: []
            });
        }
        
        const cleanQuery = query.replace('@', '').trim();
        
        const result = await pool.query(
            `SELECT user_id, username, display_name, profile_image, status, bio, phone
             FROM users 
             WHERE username ILIKE $1 OR display_name ILIKE $1
             LIMIT 20`,
            [`%${cleanQuery}%`]
        );
        
        // Преобразуем snake_case в camelCase
        const formattedUsers = result.rows.map(user => ({
            id: user.user_id, 
            user_id: user.user_id, 
            username: user.username || user.phone || 'user',
            display_name: user.display_name || 'Пользователь', 
            displayName: user.display_name || 'Пользователь', 
            profile_image: user.profile_image,
            profileImage: user.profile_image,
            status: user.status || 'offline',
            bio: user.bio || '',
            phone: user.phone || ''
        }));

        res.json({
            success: true,
            count: formattedUsers.length,
            users: formattedUsers
        });
        
    } catch (error) {
        console.error('❌ Search error:', error);
        res.status(500).json({
            success: false,
            error: 'Search failed'
        });
    }
});

// ==================== 🔍 ПОИСК ПОЛЬЗОВАТЕЛЕЙ ПО USERNAME ====================
app.get('/api/users/search/username/:username', async (req, res) => {
    try {
        const { username } = req.params;
        console.log('🔍 Searching user by username:', username);
        
        const result = await pool.query(
            `SELECT user_id, username, display_name, profile_image, status, bio
             FROM users 
             WHERE username ILIKE $1 
             ORDER BY 
                 CASE 
                     WHEN username = $1 THEN 1
                     WHEN username ILIKE $2 THEN 2
                     ELSE 3
                 END
             LIMIT 20`,
            [`%${username}%`, `${username}%`]
        );
        
        res.json({
            success: true,
            users: result.rows
        });
        
    } catch (error) {
        console.error('❌ Error searching users by username:', error);
        res.status(500).json({
            success: false,
            error: 'Search failed'
        });
    }
});

// ==================== 👤 ПОЛУЧИТЬ ПОЛЬЗОВАТЕЛЯ ПО ID ====================
app.get('/api/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // 🔥 ВАЖНО: Если userId = "search" - это уже обработано выше!
        if (userId === 'search') {
            return res.status(400).json({ 
                error: 'Invalid user ID' 
            });
        }
        
        const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        console.log('✅ Пользователь найден:', result.rows[0].username);
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('❌ Ошибка получения пользователя:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== ✏️ ОБНОВИТЬ ПРОФИЛЬ ====================
app.put('/api/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { display_name, username, bio, phone } = req.body;

        console.log('✏️ Updating profile:', { userId, username });

        // 🔥 ПРАВИЛЬНАЯ ПРОВЕРКА: 
        const currentUser = await pool.query(
            'SELECT username FROM users WHERE user_id = $1',
            [userId]
        );
        
        if (currentUser.rows.length > 0) {
            const currentUsername = currentUser.rows[0].username;
            
            if (currentUsername !== username) {
                const checkResult = await pool.query(
                    'SELECT user_id FROM users WHERE username = $1',
                    [username]
                );
                
                if (checkResult.rows.length > 0) {
                    return res.status(400).json({ 
                        success: false,
                        error: 'Username already taken' 
                    });
                }
            }
        }

        const result = await pool.query(
            'UPDATE users SET display_name = $1, username = $2, bio = $3, phone = $4 WHERE user_id = $5 RETURNING *',
            [display_name, username, bio, phone, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'User not found' 
            });
        }

        const updatedUser = result.rows[0];
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('❌ Error updating profile:', error);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
});

// Модель для хранения звонков в базе
app.get('/api/calls/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const result = await pool.query(
            `SELECT * FROM calls 
             WHERE from_user_id = $1 OR to_user_id = $1 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [userId]
        );

        console.log('📞 Call history loaded for user:', userId, 'calls:', result.rows.length);
        
        res.json(result.rows);

    } catch (error) {
        console.error('❌ Error loading call history:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка загрузки истории звонков' 
        });
    }
});

// ==================== ⚙️ СИСТЕМА НАСТРОЕК ====================

// Эндпоинт для обновления настроек пользователя
app.put('/api/users/:userId/settings', async (req, res) => {
    try {
        const { userId } = req.params;
        const { 
            messageNotifications = true, 
            callNotifications = true, 
            notificationSound = true, 
            onlineStatus = true, 
            readReceipts = true 
        } = req.body;

        console.log('⚙️ Updating settings for user:', userId, { 
            messageNotifications, callNotifications, notificationSound, onlineStatus, readReceipts 
        });

        // Проверяем существование пользователя
        const userCheck = await pool.query(
            'SELECT * FROM users WHERE user_id = $1',
            [userId]
        );

        if (userCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Пользователь не найден' 
            });
        }

        // Обновляем настройки в базе
        const result = await pool.query(
            `UPDATE users SET 
                message_notifications = $1,
                call_notifications = $2, 
                notification_sound = $3,
                online_status = $4,
                read_receipts = $5,
                settings_updated_at = $6
             WHERE user_id = $7 RETURNING *`,
            [messageNotifications, callNotifications, notificationSound, onlineStatus, readReceipts, new Date(), userId]
        );

        const updatedUser = result.rows[0];
        console.log('✅ Settings updated for user:', userId);
        
        res.json({
            success: true,
            message: 'Настройки успешно обновлены',
            user: {
                message_notifications: updatedUser.message_notifications,
                call_notifications: updatedUser.call_notifications,
                notification_sound: updatedUser.notification_sound,
                online_status: updatedUser.online_status,
                read_receipts: updatedUser.read_receipts
            }
        });

    } catch (error) {
        console.error('❌ Error updating settings:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка обновления настроек: ' + error.message 
        });
    }
});

// Эндпоинт для получения настроек пользователя
app.get('/api/users/:userId/settings', async (req, res) => {
    try {
        const { userId } = req.params;

        console.log('⚙️ Getting settings for user:', userId);

        const result = await pool.query(
            `SELECT 
                message_notifications,
                call_notifications,
                notification_sound, 
                online_status,
                read_receipts,
                settings_updated_at
             FROM users WHERE user_id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Пользователь не найден' 
            });
        }

        const settings = result.rows[0];
        console.log('✅ Settings loaded for user:', userId);
        
        res.json({
            success: true,
            settings: settings
        });

    } catch (error) {
        console.error('❌ Error getting settings:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка получения настроек: ' + error.message 
        });
    }
});
// Создать шаблонный ответ
app.post('/api/moderation/templates', async (req, res) => {
    try {
        const { title, content, category, createdBy } = req.body;
        
        const templateId = 'template_' + Date.now();
        
        const result = await pool.query(
            `INSERT INTO template_responses (id, title, content, category, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [templateId, title, content, category, createdBy]
        );
        
        console.log('✅ Шаблон создан:', title);
        
        res.json({
            success: true,
            message: 'Template created successfully',
            template: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания шаблона:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to create template' 
        });
    }
});

// Использовать шаблон для ответа на жалобу
app.post('/api/moderation/reports/:reportId/respond', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { templateId, moderatorId, additionalNotes } = req.body;
        
        // Получаем шаблон
        const templateResult = await pool.query(
            'SELECT * FROM template_responses WHERE id = $1',
            [templateId]
        );
        
        if (templateResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Template not found' 
            });
        }
        
        const template = templateResult.rows[0];
        
        // Обновляем жалобу
        const resolution = additionalNotes 
            ? `${template.content}\n\nДополнительно: ${additionalNotes}`
            : template.content;
            
        const result = await pool.query(
            `UPDATE reports 
             SET status = 'resolved', resolution = $1, resolved_at = $2, assigned_moderator_id = $3
             WHERE id = $4 RETURNING *`,
            [resolution, Date.now(), moderatorId, reportId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Report not found' 
            });
        }
        
        const report = result.rows[0];
    
    io.emit('report_resolved', report);
    
    res.json({
      success: true,
      message: 'Report resolved with template',
      report: report,
      templateUsed: template.title
    });
    
  } catch (error) {
    console.error('❌ Ошибка ответа на жалобу:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to respond to report' 
    });
  }
});

// ==================== 👤 ПРОВЕРКА USERNAME ====================
app.get('/api/username/check/:username', async (req, res) => {
    try {
        const { username } = req.params;
        console.log('🔍 Checking username:', username);
        
        // Проверяем, занят ли username
        const result = await pool.query(
            'SELECT user_id FROM users WHERE username ILIKE $1',
            [username]
        );
        
        const isAvailable = result.rows.length === 0;
        
        res.json({
            success: true,
            available: isAvailable,
            message: isAvailable 
                ? 'Username available' 
                : 'Username already taken'
        });
        
    } catch (error) {
        console.error('❌ Error checking username:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

// ==================== ✏️ ОБНОВИТЬ USERNAME ====================
app.put('/api/users/:userId/username', async (req, res) => {
    try {
        const { userId } = req.params;
        const { username } = req.body;
        
        console.log('✏️ Updating username:', { userId, username });
        
        // Проверяем, не занят ли новый username другим пользователем
        const checkResult = await pool.query(
            'SELECT user_id FROM users WHERE username ILIKE $1 AND user_id != $2',
            [username, userId]
        );
        
        if (checkResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Username already taken'
            });
        }
        
        // Обновляем username
        const updateResult = await pool.query(
            'UPDATE users SET username = $1 WHERE user_id = $2 RETURNING *',
            [username, userId]
        );
        
        if (updateResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Username updated successfully',
            user: updateResult.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Error updating username:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

// ==================== 🛡️ СИСТЕМА МОДЕРАЦИИ ====================

// 📋 Получить очередь жалоб
app.get('/api/moderation/reports', async (req, res) => {
  try {
    const { status = 'pending', limit = 50 } = req.query;
    
    const result = await pool.query(
      `SELECT r.*, 
              reporter.username as reporter_username,
              reported.username as reported_username,
              reporter.is_premium as is_premium
       FROM reports r
       LEFT JOIN users reporter ON r.reporter_id = reporter.user_id
       LEFT JOIN users reported ON r.reported_user_id = reported.user_id
       WHERE r.status = $1
       ORDER BY 
         reporter.is_premium DESC,
         r.priority DESC,
         r.created_at ASC
       LIMIT $2`,
      [status, parseInt(limit)]
    );
    
    console.log(`✅ Получено жалоб: ${result.rows.length}`);
    
    res.json({
      success: true,
      count: result.rows.length,
      reports: result.rows
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения жалоб:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get reports' 
    });
  }
});

// 📨 Отправить жалобу
app.post('/api/moderation/reports', async (req, res) => {
  try {
    const { reporterId, reportedUserId, messageId, reason } = req.body;
    
    console.log('🆘 Новая жалоба:', { reporterId, reportedUserId, reason });
    
    const reportId = 'report_' + Date.now();
    
    // Проверяем премиум статус
    const reporterResult = await pool.query(
      'SELECT is_premium FROM users WHERE user_id = $1',
      [reporterId]
    );
    
    const isPremium = reporterResult.rows[0]?.is_premium || false;
    
    // Определяем приоритет
    let priority = 'medium';
    if (isPremium) priority = 'high';
    
    // Критические ключевые слова
    const criticalKeywords = ['спам', 'мошенничество', 'угрозы'];
    if (criticalKeywords.some(word => reason.toLowerCase().includes(word))) {
      priority = 'critical';
    }
    
    const result = await pool.query(
      `INSERT INTO reports (id, reporter_id, reported_user_id, reported_message_id, reason, priority, is_premium)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [reportId, reporterId, reportedUserId, messageId, reason, priority, isPremium]
    );
    
    const report = result.rows[0];
    
    io.emit('new_report', report);
    
    console.log('✅ Жалоба создана:', report.id);
    
    res.json({
      success: true,
      message: 'Report submitted successfully',
      report: report
    });
    
  } catch (error) {
    console.error('❌ Ошибка создания жалобы:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to submit report' 
    });
  }
});

// 👮 Назначить жалобу модератору
app.patch('/api/moderation/reports/:reportId/assign', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { moderatorId } = req.body;
    
    const result = await pool.query(
      `UPDATE reports 
       SET status = 'in_progress', assigned_moderator_id = $1
       WHERE id = $2 RETURNING *`,
      [moderatorId, reportId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Report not found' 
      });
    }
    
    const report = result.rows[0];
    
    io.emit('report_updated', report);
    
    res.json({
      success: true,
      message: 'Report assigned to moderator',
      report: report
    });
    
  } catch (error) {
    console.error('❌ Ошибка назначения жалобы:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to assign report' 
    });
  }
});

// 📊 Дашборд модерации
app.get('/api/moderation/dashboard', async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    const startTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 дней
    
    const [
      totalReports,
      resolvedReports,
      pendingReports,
      avgResolutionTime
    ] = await Promise.all([
      // Всего жалоб
      pool.query('SELECT COUNT(*) FROM reports WHERE created_at > $1', [startTime]),
      // Решенные жалобы
      pool.query('SELECT COUNT(*) FROM reports WHERE status = $1 AND created_at > $1', ['resolved', startTime]),
      // Ожидающие жалобы
      pool.query('SELECT COUNT(*) FROM reports WHERE status = $1', ['pending']),
      // Среднее время решения
      pool.query(`
        SELECT AVG(resolved_at - created_at) as avg_time 
        FROM reports 
        WHERE status = 'resolved' AND resolved_at IS NOT NULL
      `)
    ]);
    
    const stats = {
      totalReports: parseInt(totalReports.rows[0].count),
      resolvedReports: parseInt(resolvedReports.rows[0].count),
      pendingReports: parseInt(pendingReports.rows[0].count),
      resolutionRate: totalReports.rows[0].count > 0 
        ? ((resolvedReports.rows[0].count / totalReports.rows[0].count) * 100).toFixed(1)
        : 0,
      avgResolutionTime: avgResolutionTime.rows[0].avg_time 
        ? Math.round(avgResolutionTime.rows[0].avg_time / 60000) // в минуты
        : 0
    };
    
    res.json({
      success: true,
      period: period,
      stats: stats
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения дашборда:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get dashboard' 
    });
  }
});

// ==================== 📋 ПОЛУЧИТЬ ВСЕ ГРУППЫ ====================
app.get('/api/groups', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT g.*, COUNT(gm.user_id) as member_count
            FROM groups g
            LEFT JOIN group_members gm ON g.id = gm.group_id
            GROUP BY g.id
            ORDER BY g.created_at DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error getting groups:', error);
        res.status(500).json({ error: 'Failed to get groups' });
    }
});

// ==================== 🔍 ПОИСК ГРУПП ====================
app.get('/api/groups/search', async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.length < 2) {
            return res.json([]);
        }
        
        const result = await pool.query(`
            SELECT g.*, COUNT(gm.user_id) as member_count
            FROM groups g
            LEFT JOIN group_members gm ON g.id = gm.group_id
            WHERE g.name ILIKE $1 OR g.description ILIKE $1
            GROUP BY g.id
            ORDER BY g.created_at DESC
        `, [`%${query}%`]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error searching groups:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Создать группу
app.post('/api/groups', async (req, res) => {
  try {
    const { name, description, createdBy } = req.body;
    const groupId = 'group_' + Date.now();
    
    console.log('👥 Создание группы:', { name, createdBy });
    
    const result = await pool.query(
      `INSERT INTO groups (id, name, description, created_by, created_at) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [groupId, name, description, createdBy, Date.now()]
    );

    // Добавляем создателя как администратора
    await pool.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [groupId, createdBy, 'admin']
    );

    const group = result.rows[0];
    group.members = {
      [createdBy]: 'admin'
    };

    console.log('✅ Группа создана:', group.name);
    res.status(201).json(group);
  } catch (error) {
    console.error('❌ Ошибка создания группы:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Добавить пользователя в группу
app.post('/api/groups/:groupId/members', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId, role = 'member' } = req.body;

    console.log('👥 Добавление пользователя в группу:', { groupId, userId, role });

    const result = await pool.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) RETURNING *',
      [groupId, userId, role]
    );

    console.log('✅ Пользователь добавлен в группу');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка добавления пользователя в группу:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получить группы пользователя
app.get('/api/users/:userId/groups', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT g.*, gm.role 
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [userId]
    );

    console.log(`✅ Найдено групп для пользователя ${userId}: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка получения групп пользователя:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== 🔍 ПОИСК ПО USERNAME ДЛЯ УПОМИНАНИЙ ====================
app.get('/api/username/search', async (req, res) => {
    try {
        let { query } = req.query;
        
        if (query) {
            query = decodeURIComponent(query);
        }
        
        if (!query || query.trim().length < 2) {
            return res.json({
                success: true,
                users: []
            });
        }
        
        console.log('🔍 Searching by username for mentions:', query);
        
        const result = await pool.query(
            `SELECT user_id, username, display_name, profile_image
             FROM users 
             WHERE username ILIKE $1
             ORDER BY 
                 CASE WHEN username = $2 THEN 1
                      WHEN username ILIKE $3 THEN 2
                      ELSE 3 END
             LIMIT 10`,
            [`%${query}%`, query, `${query}%`]
        );
        
        res.json({
            success: true,
            users: result.rows
        });
        
    } catch (error) {
        console.error('❌ Username search error:', error);
        res.status(500).json({
            success: false,
            error: 'Username search failed'
        });
    }
});

// ==================== 🎯 ОСНОВНЫЕ ЭНДПОИНТЫ ====================

// Корневой эндпоинт
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Messenger Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      chats: '/api/chats',
      messages: '/api/messages',
      groups: '/api/groups',
      moderation: '/api/moderation',
      security: '/api/security'
    }
  });
});

// Health check
app.get('/health', async (req, res) => {
  try {
    // Проверяем подключение к базе данных
    await pool.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
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

// Обработка 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Глобальный обработчик ошибок
app.use((error, req, res, next) => {
  console.error('🔥 Global error handler:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Инициализируем базу при запуске
initializeDatabase().then(() => {
  console.log('✅ Database initialization completed');
}).catch(error => {
  console.error('❌ Database initialization failed:', error);
});

// Запуск сервера
server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Messenger backend running on port ${port}`);
  console.log(`🔗 WebSocket server ready`);
  console.log(`📊 Database: PostgreSQL`);
  console.log(`🔐 Auth endpoints: /api/auth/register, /api/auth/multi-level-login`);
  console.log(`💬 Chat endpoints: /api/chats, /api/messages, /api/messages/send`);
  console.log(`👥 Group endpoints: /api/groups, /api/groups/:id`);
  console.log(`🛡️ Moderation endpoints: /api/moderation/*`);
  console.log(`🔒 Security endpoints: /api/security/*`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log(`🌐 Health check: http://localhost:${port}/health`);
  console.log('🚀 ======= SERVER STARTED =======');
  console.log('🕒 Time:', new Date().toISOString());
  console.log('📁 Current directory:', __dirname);
});
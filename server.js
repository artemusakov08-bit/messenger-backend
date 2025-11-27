const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const http = require('http');

// 🔥 ПОДКЛЮЧАЕМ НОВЫЕ КОНТРОЛЛЕРЫ
const authRoutes = require('./src/routes/auth');
const db = require('./src/config/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = process.env.PORT || 10000;

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
  console.log('📦 Body:', req.body);
  next();
});

// 🔥 ПОДКЛЮЧАЕМ РОУТЫ
app.use('/api/auth', authRoutes);

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
    
    // 🔥 УДАЛЯЕМ И СОЗДАЕМ ТАБЛИЦУ USERS ЗАНОВО
    await db.query('DROP TABLE IF EXISTS users CASCADE');
    
    await db.query(`
      CREATE TABLE users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        email TEXT,
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
        auth_level VARCHAR(50) DEFAULT 'sms_only'
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'private',
        timestamp BIGINT
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
    
    // Создаем таблицы для групп
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

    // 🆕 ТАБЛИЦЫ ДЛЯ МОДЕРАЦИИ
    console.log('🔄 Creating moderation tables...');
    
    // Таблица жалоб
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
    
    // Действия модерации
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
    
    // Шаблонные ответы
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
    
    // Аудит действий
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
    
    console.log('✅ All database tables created/verified');
    
  } catch (error) {
    console.error('❌ Database initialization error:', error);
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

  // Регистрация пользователя
  socket.on('user_connected', (userId) => {
    connectedUsers.set(userId, socket.id);
    console.log(`👤 Пользователь ${userId} подключен (socket: ${socket.id})`);
    
    // Обновляем статус в базе
    pool.query(
      'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
      ['online', Date.now(), userId]
    ).catch(console.error);
    
    // Уведомляем всех о новом онлайн пользователе
    socket.broadcast.emit('user_online', userId);
  });

  // Отправка сообщения через WebSocket
  socket.on('send_message', async (messageData) => {
    try {
        console.log('💬 WebSocket сообщение получено:', messageData); 
        
        const { chatId, text, senderId, senderName, type = 'text' } = messageData;

        // Сохраняем в базу
        const messageId = 'msg_' + Date.now();
        const result = await pool.query(
            `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [messageId, chatId, text, senderId, senderName, Date.now(), type]
        );

        const savedMessage = result.rows[0];
        
        console.log('✅ Сообщение сохранено в БД:', savedMessage);
        console.log('📤 Отправляю всем клиентам...');
        
        // Отправляем сообщение ВСЕМ подключенным клиентам
        io.emit('new_message', savedMessage);
        
        console.log('✅ Сообщение отправлено всем клиентам');

    } catch (error) {
        console.error('❌ Ошибка отправки сообщения:', error);
        socket.emit('message_error', { error: 'Failed to send message' });
    }
  });

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`👥 Пользователь ${socket.id} присоединился к чату ${chatId}`);
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
        ).catch(console.error);
        
        // Уведомляем всех о offline пользователе
        socket.broadcast.emit('user_offline', userId);
        break;
      }
    }
  });
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

// 🔧 ЭНДПОИНТ ДЛЯ ПОИСКА ПОЛЬЗОВАТЕЛЯ ПО ТЕЛЕФОНУ
app.get('/api/moderation/user/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    console.log('🔍 Searching user by phone:', phone);
    
    const client = await db.getClient();
    const result = await client.query(
      'SELECT user_id, username, display_name, phone, role, status, is_premium, auth_level FROM users WHERE phone = $1',
      [phone]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }
    
    const user = result.rows[0];
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
    console.error('❌ Error in moderation user by phone endpoint:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

app.get('/api/test-db', async (req, res) => {
  try {
    console.log('🔧 Testing database connection...');
    const result = await pool.query('SELECT NOW() as time');
    res.json({ 
      success: true, 
      message: 'Database connected',
      time: result.rows[0].time 
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: 'Database error: ' + error.message 
    });
  }
});

app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
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

// 💬 Чаты
app.get('/api/chats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM chats ORDER BY timestamp DESC');
    console.log(`✅ Получено чатов: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка получения чатов:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await pool.query(
      'SELECT * FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC',
      [chatId]
    );
    console.log(`✅ Получено сообщений для чата ${chatId}: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка получения сообщений:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 📨 ОТПРАВКА СООБЩЕНИЙ - ОБА ЭНДПОИНТА
app.post('/api/messages', async (req, res) => {
  console.log('📨 POST /api/messages - Body:', req.body);
  
  try {
    const { 
      chatId, text, senderId, senderName, 
      type = 'text'
    } = req.body;

    console.log('📝 Параметры:', { chatId, text, senderId, senderName });

    // Проверка обязательных полей
    if (!chatId || !text || !senderId || !senderName) {
      console.log('❌ Отсутствуют обязательные поля');
      return res.status(400).json({ 
        error: 'Missing required fields: chatId, text, senderId, senderName' 
      });
    }

    const messageId = 'msg_' + Date.now();
    
    console.log('💾 Сохраняем в базу...');
    
    const result = await pool.query(
      `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [messageId, chatId, text, senderId, senderName, Date.now(), type]
    );

    const savedMessage = result.rows[0];

    console.log('✅ Сообщение сохранено:', { 
      id: savedMessage.id, 
      chatId: savedMessage.chat_id,
      text: savedMessage.text 
    });

    // Отправляем сообщение через WebSocket всем подключенным клиентам
    io.emit('new_message', savedMessage);
    
    res.json(savedMessage);
  } catch (error) {
    console.error('❌ Ошибка отправки сообщения:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// 🔧 ДОПОЛНИТЕЛЬНЫЙ ЭНДПОИНТ ДЛЯ ФРОНТЕНДА
app.post('/api/messages/send', async (req, res) => {
  console.log('📨 POST /api/messages/send - Body:', req.body);
  
  try {
    const { 
      chatId, text, senderId, senderName, 
      type = 'text'
    } = req.body;

    console.log('📝 Параметры:', { chatId, text, senderId, senderName });

    // Проверка обязательных полей
    if (!chatId || !text || !senderId || !senderName) {
      console.log('❌ Отсутствуют обязательные поля');
      return res.status(400).json({ 
        error: 'Missing required fields: chatId, text, senderId, senderName' 
      });
    }

    const messageId = 'msg_' + Date.now();
    
    console.log('💾 Сохраняем в базу...');
    
    const result = await pool.query(
      `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [messageId, chatId, text, senderId, senderName, Date.now(), type]
    );

    const savedMessage = result.rows[0];

    console.log('✅ Сообщение сохранено через /send:', { 
      id: savedMessage.id, 
      chatId: savedMessage.chat_id,
      text: savedMessage.text 
    });

    // Отправляем сообщение через WebSocket всем подключенным клиентам
    io.emit('new_message', savedMessage);
    
    res.json(savedMessage);
  } catch (error) {
    console.error('❌ Ошибка отправки сообщения через /send:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
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

// ==================== 🆕 ГРУППЫ ====================

// Получить информацию о группе
app.get('/api/groups/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    
    const groupResult = await pool.query(
      'SELECT * FROM groups WHERE id = $1',
      [groupId]
    );
    
    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    const group = groupResult.rows[0];
    
    // Получаем участники группы
    const membersResult = await pool.query(
      'SELECT user_id, role FROM group_members WHERE group_id = $1',
      [groupId]
    );
    
    // Преобразуем в объект {userId: role}
    const members = {};
    membersResult.rows.forEach(member => {
      members[member.user_id] = member.role;
    });
    
    group.members = members;
    
    console.log('✅ Группа найдена:', group.name);
    res.json(group);
  } catch (error) {
    console.error('❌ Ошибка получения группы:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// Инициализируем базу при запуске
initializeDatabase();

// Запуск сервера
server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Messenger backend running on port ${port}`);
  console.log(`🔗 WebSocket server ready`);
  console.log(`📊 Database: PostgreSQL`);
  console.log(`🔐 Auth endpoints: /api/auth/register, /api/auth/multi-level-login`);
  console.log(`💬 Chat endpoints: /api/chats, /api/messages, /api/messages/send`);
  console.log(`👥 Group endpoints: /api/groups, /api/groups/:id`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});
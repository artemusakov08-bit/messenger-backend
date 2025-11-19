const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = 3000;

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

// Подключение к PostgreSQL
const pool = new Pool({
  user: 'messenger_user',
  host: 'postgres',
  database: 'messenger',
  password: 'messenger_password123',
  port: 5432,
});

// Подключение к Redis
const redisClient = redis.createClient({
  socket: {
    host: 'redis',
    port: 6379
  }
});

// Подключаем Redis
redisClient.connect().catch(console.error);

// Хранилище подключенных пользователей
const connectedUsers = new Map();

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('🔗 Пользователь подключился:', socket.id);

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

  // Присоединение к комнате чата
  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`👥 Пользователь ${socket.id} присоединился к чату ${chatId}`);
  });

  // Покидание комнаты чата
  socket.on('leave_chat', (chatId) => {
    socket.leave(chatId);
    console.log(`👥 Пользователь ${socket.id} покинул чат ${chatId}`);
  });

  // Отключение пользователя
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

// Простой тестовый маршрут
app.get('/', (req, res) => {
  res.json({ 
    message: 'Messenger Backend работает! 🚀',
    timestamp: new Date().toISOString(),
    connectedUsers: connectedUsers.size
  });
});

// 🔐 Аутентификация
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('🔐 Попытка входа:', { username });
    
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    await pool.query(
      'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
      ['online', Date.now(), result.rows[0].user_id]
    );
    
    console.log('✅ Успешный вход:', result.rows[0].username);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка входа:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, display_name } = req.body;
    const userId = 'user_' + Date.now();
    
    console.log('👤 Регистрация:', { username, email, display_name });
    
    const result = await pool.query(
      `INSERT INTO users (user_id, username, email, display_name, status) 
       VALUES ($1, $2, $3, $4, 'online') RETURNING *`,
      [userId, username, email, display_name]
    );
    
    console.log('✅ Пользователь создан:', result.rows[0].username);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 👥 Пользователи
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    console.log(`✅ Получено пользователей: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка получения пользователей:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    
    // Получаем участников группы
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

// Запуск сервера
server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Messenger backend running on port ${port}`);
  console.log(`🔗 WebSocket server ready`);
  console.log(`📊 Database: PostgreSQL`);
  console.log(`🔴 Cache: Redis`);
  console.log(`🔐 Auth endpoints: /api/auth/login, /api/auth/register`);
  console.log(`💬 Chat endpoints: /api/chats, /api/messages, /api/messages/send`);
  console.log(`👥 Group endpoints: /api/groups, /api/groups/:id`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});
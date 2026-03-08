const pool = require('../config/database');

let syncService = null;
let chatSocketInstance = null;

const setSyncService = (service) => {
    syncService = service;
};

const setChatSocket = (socketInstance) => {
    chatSocketInstance = socketInstance;
};

const extractParticipantIds = (chatId) => {
    try {
        const cleanChatId = chatId.replace(/user_/g, '');
        const parts = cleanChatId.split('_');
        
        if (parts.length < 2) {
            console.error(`❌ Неверный формат chatId: ${chatId}`);
            return [];
        }
        
        const participant1 = parts[0];
        const participant2 = parts[1];
        
        return [participant1, participant2];
        
    } catch (error) {
        console.error(`❌ Ошибка извлечения участников:`, error);
        return [];
    }
};

// 📤 Отправка сообщения с синхронизацией
const sendMessage = async (req, res) => {
    const connection = await pool.connect();
    
    try {
        await connection.query('BEGIN');
        
        const { chat_id: chatId, text, sender_id: senderId, sender_name: senderName, type = 'text' } = req.body;
        const { deviceId } = req.user;
        
        console.log(`📤 Отправка сообщения от ${senderId} (устройство ${deviceId}) в ${chatId}`);
        
        if (!chatId || !text || !senderId || !senderName) {
            await connection.query('ROLLBACK');
            return res.status(400).json({
                error: 'Missing required fields'
            });
        }

        // 1. Проверяем/создаем чат
        const chatCheck = await connection.query(
            'SELECT id FROM chats WHERE id = $1',
            [chatId]
        );

        if (chatCheck.rows.length === 0) {
            const participants = extractParticipantIds(chatId);
            let otherUserName = 'Приватный чат';
            
            if (participants.length === 2) {
                const otherUserId = participants.find(id => String(id) !== String(senderId));
                
                if (otherUserId) {
                    const userResult = await connection.query(
                        'SELECT display_name FROM users WHERE user_id = $1',
                        [otherUserId]
                    );
                    
                    otherUserName = userResult.rows.length > 0 
                        ? userResult.rows[0].display_name 
                        : `User ${String(otherUserId).slice(-4)}`;
                }
            }
            
            await connection.query(
                `INSERT INTO chats (id, name, type, timestamp, last_message) 
                VALUES ($1, $2, $3, $4, $5)`,
                [chatId, otherUserName, 'private', Date.now(), text]
            );
        } else {
            await connection.query(
                `UPDATE chats 
                SET timestamp = $1, last_message = $2 
                WHERE id = $3`,
                [Date.now(), text, chatId]
            );
        }

        // 2. Сохраняем сообщение
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        
        const messageResult = await connection.query(
            `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING *`,
            [messageId, chatId, text, senderId, senderName, Date.now(), type]
        );

        const savedMessage = messageResult.rows[0];
        
        await connection.query('COMMIT');
        
        console.log(`✅ Сообщение сохранено: ${messageId}`);
        
        // 3. Синхронизация через SyncService
        if (syncService) {
            // Синхронизация на другие устройства отправителя
            await syncService.syncMessage(senderId, {
                chatId: chatId,
                message: savedMessage,
                senderDeviceId: deviceId
            });
            
            // Отправка получателю через chatSocket
            const participants = extractParticipantIds(chatId);
            const receiverId = participants.find(id => String(id) !== String(senderId));
            
            if (receiverId && chatSocketInstance) {
                chatSocketInstance.sendToUser(receiverId, {
                    type: 'new_message',
                    chatId: chatId,
                    message: savedMessage,
                    timestamp: Date.now()
                });
            }
        }
        
        res.status(201).json({
            ...savedMessage,
            deliveryStatus: 'sent',
            synced: true
        });
        
    } catch (error) {
        await connection.query('ROLLBACK');
        console.error('❌ Ошибка отправки сообщения:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message
        });
    } finally {
        connection.release();
    }
};

// 👁️ Отметка сообщения прочитанным с синхронизацией
const markMessageAsRead = async (req, res) => {
    try {
        const { messageId, chatId } = req.body;
        const { userId, deviceId } = req.user;
        
        console.log(`👁️ Отметка прочтения ${messageId} пользователем ${userId} (устройство ${deviceId})`);
        
        const result = await pool.query(
            `UPDATE messages 
             SET read = true, read_at = $1 
             WHERE id = $2 AND chat_id = $3
             RETURNING *`,
            [Date.now(), messageId, chatId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        const updatedMessage = result.rows[0];
        
        // Синхронизация статуса прочтения
        if (syncService) {
            await syncService.syncMessageRead(userId, {
                chatId: chatId,
                messageId: messageId,
                readerDeviceId: deviceId
            });
        }
        
        // Уведомление отправителя о прочтении
        const senderId = updatedMessage.sender_id;
        if (String(senderId) !== String(userId) && chatSocketInstance) {
            chatSocketInstance.sendToUser(senderId, {
                type: 'message_read',
                messageId: messageId,
                chatId: chatId,
                readerId: userId,
                timestamp: Date.now()
            });
        }
        
        res.json({
            success: true,
            message: 'Message marked as read',
            messageId: messageId,
            synced: true
        });
        
    } catch (error) {
        console.error('❌ Ошибка отметки прочтения:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// ✏️ Редактирование сообщения с синхронизацией
const editMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { newText, chatId } = req.body;
        const { userId, deviceId } = req.user;
        
        console.log(`✏️ Редактирование ${messageId} пользователем ${userId}`);
        
        const messageCheck = await pool.query(
            'SELECT sender_id FROM messages WHERE id = $1',
            [messageId]
        );
        
        if (messageCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        const message = messageCheck.rows[0];
        
        if (String(message.sender_id) !== String(userId)) {
            return res.status(403).json({ error: 'You can only edit your own messages' });
        }
        
        const result = await pool.query(
            `UPDATE messages 
             SET text = $1, edited = true, edited_at = $2 
             WHERE id = $3
             RETURNING *`,
            [newText, Date.now(), messageId]
        );
        
        const editedMessage = result.rows[0];
        
        // Синхронизация редактирования
        if (syncService) {
            await syncService.syncMessageEdit(userId, {
                chatId: chatId,
                messageId: messageId,
                newText: newText,
                editorDeviceId: deviceId
            });
        }
        
        // Уведомление других участников чата
        const participants = extractParticipantIds(chatId);
        participants.forEach(participantId => {
            if (String(participantId) !== String(userId) && chatSocketInstance) {
                chatSocketInstance.sendToUser(participantId, {
                    type: 'message_edited',
                    messageId: messageId,
                    chatId: chatId,
                    newText: newText,
                    timestamp: Date.now()
                });
            }
        });
        
        res.json({
            success: true,
            message: 'Message edited',
            editedMessage: editedMessage,
            synced: true
        });
        
    } catch (error) {
        console.error('❌ Ошибка редактирования сообщения:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// 🗑️ Удаление сообщения с синхронизацией
const deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { chatId } = req.body;
        const { userId, deviceId } = req.user;
        
        console.log(`🗑️ Удаление ${messageId} пользователем ${userId}`);
        
        const messageCheck = await pool.query(
            'SELECT sender_id FROM messages WHERE id = $1',
            [messageId]
        );
        
        if (messageCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        const message = messageCheck.rows[0];
        
        if (String(message.sender_id) !== String(userId)) {
            return res.status(403).json({ error: 'You can only delete your own messages' });
        }
        
        const result = await pool.query(
            'DELETE FROM messages WHERE id = $1 RETURNING *',
            [messageId]
        );
        
        const deletedMessage = result.rows[0];
        
        // Синхронизация удаления
        if (syncService) {
            await syncService.syncMessageDelete(userId, {
                chatId: chatId,
                messageId: messageId,
                deleterDeviceId: deviceId
            });
        }
        
        // Уведомление других участников чата
        const participants = extractParticipantIds(chatId);
        participants.forEach(participantId => {
            if (String(participantId) !== String(userId) && chatSocketInstance) {
                chatSocketInstance.sendToUser(participantId, {
                    type: 'message_deleted',
                    messageId: messageId,
                    chatId: chatId,
                    timestamp: Date.now()
                });
            }
        });
        
        res.json({ 
            success: true, 
            message: 'Message deleted',
            deletedMessage: deletedMessage,
            synced: true
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления сообщения:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// 💬 Установка статуса "печатает" с синхронизацией
const setTypingStatus = async (req, res) => {
    try {
        const { chatId, isTyping } = req.body;
        const { userId, deviceId } = req.user;
        
        console.log(`💬 Статус печатания: ${userId} ${isTyping ? 'печатает' : 'остановился'} в ${chatId}`);
        
        // Синхронизация статуса печатания
        if (syncService) {
            await syncService.syncTyping(userId, {
                chatId: chatId,
                isTyping: isTyping,
                deviceId: deviceId
            });
        }
        
        // Уведомление других участников чата
        const participants = extractParticipantIds(chatId);
        participants.forEach(participantId => {
            if (String(participantId) !== String(userId) && chatSocketInstance) {
                chatSocketInstance.sendToUser(participantId, {
                    type: isTyping ? 'user_typing' : 'user_stopped_typing',
                    chatId: chatId,
                    userId: userId,
                    timestamp: Date.now()
                });
            }
        });
        
        res.json({
            success: true,
            isTyping: isTyping,
            synced: true
        });
        
    } catch (error) {
        console.error('❌ Ошибка установки статуса печатания:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// 📥 Получение пропущенных сообщений
const getMissedMessages = async (req, res) => {
    try {
        const { userId } = req.user;
        const { since } = req.query;
        
        console.log(`📥 Получение пропущенных сообщений для ${userId} с ${since}`);
        
        const result = await pool.query(
            `SELECT m.*, c.name as chat_name 
             FROM messages m
             JOIN chats c ON m.chat_id = c.id
             WHERE m.chat_id LIKE $1 
                OR m.chat_id LIKE $2 
                OR m.chat_id LIKE $3
             AND m.timestamp > $4
             ORDER BY m.timestamp ASC`,
            [`%${userId}%`, `${userId}_%`, `%_${userId}`, parseInt(since) || 0]
        );
        
        res.json({
            success: true,
            missedMessages: result.rows,
            count: result.rows.length,
            since: since
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения пропущенных сообщений:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// 😊 Добавление реакции
const addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const { userId } = req.user;
    
    console.log(`😊 Добавление реакции ${emoji} к сообщению ${messageId} от ${userId}`);
    
    const Reaction = require('../models/Reaction');
    const reaction = await Reaction.add(messageId, userId, emoji);
    
    if (!reaction) {
      return res.status(400).json({ error: 'Reaction already exists' });
    }
    
    // Получаем обновленные реакции
    const reactions = await Reaction.getForMessage(messageId);
    
    // Уведомляем участников чата
    const messageResult = await pool.query(
      'SELECT chat_id FROM messages WHERE id = $1',
      [messageId]
    );
    
    if (messageResult.rows.length > 0) {
      const chatId = messageResult.rows[0].chat_id;
      const participants = extractParticipantIds(chatId);
      
      participants.forEach(participantId => {
        if (String(participantId) !== String(userId) && chatSocketInstance) {
          chatSocketInstance.sendToUser(participantId, {
            type: 'reaction_added',
            messageId,
            emoji,
            userId,
            reactions,
            timestamp: Date.now()
          });
        }
      });
    }
    
    res.json({
      success: true,
      reaction,
      reactions
    });
    
  } catch (error) {
    console.error('❌ Ошибка добавления реакции:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ❌ Удаление реакции
const removeReaction = async (req, res) => {
  try {
    const { messageId, emoji } = req.params;
    const { userId } = req.user;
    
    console.log(`❌ Удаление реакции ${emoji} от сообщения ${messageId} пользователем ${userId}`);
    
    const Reaction = require('../models/Reaction');
    const removed = await Reaction.remove(messageId, userId, emoji);
    
    if (!removed) {
      return res.status(404).json({ error: 'Reaction not found' });
    }
    
    // Получаем обновленные реакции
    const reactions = await Reaction.getForMessage(messageId);
    
    // Уведомляем участников чата
    const messageResult = await pool.query(
      'SELECT chat_id FROM messages WHERE id = $1',
      [messageId]
    );
    
    if (messageResult.rows.length > 0) {
      const chatId = messageResult.rows[0].chat_id;
      const participants = extractParticipantIds(chatId);
      
      participants.forEach(participantId => {
        if (String(participantId) !== String(userId) && chatSocketInstance) {
          chatSocketInstance.sendToUser(participantId, {
            type: 'reaction_removed',
            messageId,
            emoji,
            userId,
            reactions,
            timestamp: Date.now()
          });
        }
      });
    }
    
    res.json({
      success: true,
      reactions
    });
    
  } catch (error) {
    console.error('❌ Ошибка удаления реакции:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 📥 Пересылка сообщения
const forwardMessage = async (req, res) => {
  const connection = await pool.connect();
  
  try {
    await connection.query('BEGIN');
    
    const { messageId, toChatId } = req.body;
    const { userId } = req.user;
    
    console.log(`📥 Пересылка сообщения ${messageId} в чат ${toChatId} пользователем ${userId}`);
    
    // Получаем исходное сообщение
    const sourceMessage = await connection.query(
      'SELECT * FROM messages WHERE id = $1',
      [messageId]
    );
    
    if (sourceMessage.rows.length === 0) {
      await connection.query('ROLLBACK');
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const original = sourceMessage.rows[0];
    
    // Создаем новое сообщение с пометкой forwarded
    const newMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const timestamp = Date.now();
    
    const forwardText = `⏩ Пересланное сообщение от ${original.sender_name}:\n\n${original.text}`;
    
    const result = await connection.query(
      `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type, forwarded, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [newMessageId, toChatId, forwardText, userId, original.sender_name, timestamp, original.type, true, messageId]
    );
    
    // Обновляем время последнего сообщения в чате
    await connection.query(
      'UPDATE chats SET timestamp = $1, last_message = $2 WHERE id = $3',
      [timestamp, forwardText, toChatId]
    );
    
    await connection.query('COMMIT');
    
    const newMessage = result.rows[0];
    
    // Уведомляем участников чата
    const participants = extractParticipantIds(toChatId);
    participants.forEach(participantId => {
      if (String(participantId) !== String(userId) && chatSocketInstance) {
        chatSocketInstance.sendToUser(participantId, {
          type: 'new_message',
          chatId: toChatId,
          message: newMessage,
          timestamp: Date.now()
        });
      }
    });
    
    res.status(201).json({
      success: true,
      message: newMessage
    });
    
  } catch (error) {
    await connection.query('ROLLBACK');
    console.error('❌ Ошибка пересылки сообщения:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    connection.release();
  }
};

// 📝 Ответ на сообщение
const replyToMessage = async (req, res) => {
  const connection = await pool.connect();
  
  try {
    await connection.query('BEGIN');
    
    const { replyToId, text, chatId } = req.body;
    const { userId } = req.user;
    
    console.log(`📝 Ответ на сообщение ${replyToId} пользователем ${userId}`);
    
    // Получаем имя отправителя
    const userResult = await connection.query(
      'SELECT display_name FROM users WHERE user_id = $1',
      [userId]
    );
    
    const senderName = userResult.rows[0]?.display_name || 'User';
    
    // Создаем сообщение-ответ
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const timestamp = Date.now();
    
    const result = await connection.query(
      `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [messageId, chatId, text, userId, senderName, timestamp, 'text', replyToId]
    );
    
    // Обновляем чат
    await connection.query(
      'UPDATE chats SET timestamp = $1, last_message = $2 WHERE id = $3',
      [timestamp, text, chatId]
    );
    
    await connection.query('COMMIT');
    
    const newMessage = result.rows[0];
    
    // Уведомляем участников
    const participants = extractParticipantIds(chatId);
    participants.forEach(participantId => {
      if (String(participantId) !== String(userId) && chatSocketInstance) {
        chatSocketInstance.sendToUser(participantId, {
          type: 'new_message',
          chatId,
          message: newMessage,
          timestamp: Date.now()
        });
      }
    });
    
    res.status(201).json({
      success: true,
      message: newMessage
    });
    
  } catch (error) {
    await connection.query('ROLLBACK');
    console.error('❌ Ошибка ответа на сообщение:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    connection.release();
  }
};

module.exports = {
    sendMessage,
      addReaction,
      removeReaction,
      forwardMessage,
      replyToMessage,
    getChatMessages: async (req, res) => {
        try {
            const { chatId } = req.params;
            const { limit = 100, offset = 0 } = req.query;
            
            const result = await pool.query(
                `SELECT * FROM messages 
                 WHERE chat_id = $1 
                 ORDER BY timestamp DESC 
                 LIMIT $2 OFFSET $3`,
                [chatId, parseInt(limit), parseInt(offset)]
            );
            
            res.json(result.rows.reverse());
            
        } catch (error) {
            console.error('❌ Ошибка получения сообщений:', error);
            res.status(500).json({ 
                error: 'Internal server error',
                details: error.message 
            });
        }
    },
    getRecentMessages: async (req, res) => {
        try {
            const { userId } = req.params;
            const { limit = 20 } = req.query;
            
            const result = await pool.query(
                `SELECT DISTINCT ON (m.chat_id) m.* 
                 FROM messages m
                 WHERE m.chat_id LIKE $1 OR m.chat_id LIKE $2 OR m.chat_id LIKE $3
                 ORDER BY m.chat_id, m.timestamp DESC 
                 LIMIT $4`,
                [`%${userId}%`, `${userId}_%`, `%_${userId}`, parseInt(limit)]
            );
            
            res.json(result.rows);
            
        } catch (error) {
            console.error('❌ Ошибка получения последних сообщений:', error);
            res.status(500).json({ 
                error: 'Internal server error',
                details: error.message 
            });
        }
    },
    markMessageAsRead,
    editMessage,
    deleteMessage,
    setTypingStatus,
    getMissedMessages,
    setSyncService,
    setChatSocket,
    extractParticipantIds
};
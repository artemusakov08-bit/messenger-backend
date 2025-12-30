const pool = require('../config/database');

let chatSocketInstance = null;

const setChatSocket = (socketInstance) => {
    chatSocketInstance = socketInstance;
};

// Универсальный метод извлечения ID участников
const extractParticipantIds = (chatId) => {
    try {
        console.log(`🔍 [HTTP] Извлекаем участников из chatId: ${chatId}`);
        
        // Формат: "user_123456_user_789012" или "123456_789012"
        const cleanChatId = chatId.replace(/user_/g, '');
        const parts = cleanChatId.split('_');
        
        if (parts.length < 2) {
            console.error(`❌ [HTTP] Неверный формат chatId: ${chatId}`);
            return [];
        }
        
        const participant1 = parts[0];
        const participant2 = parts[1];
        
        console.log(`🔍 [HTTP] Участники: ${participant1}, ${participant2}`);
        return [participant1, participant2];
        
    } catch (error) {
        console.error(`❌ [HTTP] Ошибка извлечения участников:`, error);
        return [];
    }
};

const sendMessage = async (req, res) => {
    const connection = await pool.connect();
    
    try {
        await connection.query('BEGIN');
        
        const { chatId, text, senderId, senderName, type = 'text' } = req.body;
        
        console.log(`📤 [HTTP] Отправка сообщения:`, {
            chatId,
            senderId,
            senderName,
            textLength: text.length,
            type
        });
        
        if (!chatId || !text || !senderId || !senderName) {
            await connection.query('ROLLBACK');
            return res.status(400).json({
                error: 'Missing required fields: chatId, text, senderId, senderName'
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
            let otherUserId = null;
            
            if (participants.length === 2) {
                otherUserId = participants.find(id => String(id) !== String(senderId));
                
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
            
            console.log(`✅ [HTTP] Чат создан: ${chatId} (${otherUserName})`);
            
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
        
        console.log(`✅ [HTTP] Сообщение сохранено: ${messageId}`);
        
        // 3. Отправляем через WebSocket
        if (chatSocketInstance) {
            console.log(`📤 [HTTP] Рассылка через WebSocket: ${chatId}`);
            
            // Проверяем участников
            const participants = extractParticipantIds(chatId);
            console.log(`👥 [HTTP] Участники чата:`, participants);
            
            // Отправляем сообщение через WebSocket
            if (chatSocketInstance.broadcastToChat) {
                chatSocketInstance.broadcastToChat(chatId, {
                    type: 'new_message',
                    chatId: savedMessage.chat_id,
                    message: savedMessage,
                    timestamp: Date.now(),
                    senderId
                });
            }
            
            // Уведомляем об обновлении списка чатов
            if (chatSocketInstance.notifyChatListUpdate) {
                chatSocketInstance.notifyChatListUpdate(chatId);
            }
        } else {
            console.error('❌ [HTTP] chatSocketInstance не установлен!');
        }
        
        res.status(201).json({
            ...savedMessage,
            deliveryStatus: 'sent'
        });
        
    } catch (error) {
        await connection.query('ROLLBACK');
        console.error('❌ [HTTP] Ошибка отправки сообщения:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        connection.release();
    }
};

const getChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const { limit = 100, offset = 0, after } = req.query;
        
        console.log(`📥 [HTTP] Запрос сообщений для чата: ${chatId}`);
        
        let query = `SELECT * FROM messages WHERE chat_id = $1`;
        const params = [chatId];
        let paramIndex = 2;
        
        if (after) {
            query += ` AND timestamp > $${paramIndex}`;
            params.push(parseInt(after));
            paramIndex++;
        }
        
        query += ` ORDER BY timestamp ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await pool.query(query, params);
        
        console.log(`✅ [HTTP] Получено ${result.rows.length} сообщений для чата ${chatId}`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ [HTTP] Ошибка получения сообщений:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

const getRecentMessages = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 20 } = req.query;
        
        console.log(`📥 [HTTP] Запрос последних сообщений для: ${userId}`);
        
        const result = await pool.query(
            `SELECT DISTINCT ON (m.chat_id) m.* 
             FROM messages m
             WHERE m.chat_id LIKE $1 OR m.chat_id LIKE $2 OR m.chat_id LIKE $3
             ORDER BY m.chat_id, m.timestamp DESC 
             LIMIT $4`,
            [`%${userId}%`, `${userId}_%`, `%_${userId}`, parseInt(limit)]
        );
        
        console.log(`✅ [HTTP] Получено ${result.rows.length} сообщений для ${userId}`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ [HTTP] Ошибка получения последних сообщений:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

const deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId } = req.body;
        
        console.log(`🗑️ [HTTP] Удаление сообщения: ${messageId} пользователем ${userId}`);
        
        const messageCheck = await pool.query(
            'SELECT sender_id, chat_id FROM messages WHERE id = $1',
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
        
        if (chatSocketInstance && chatSocketInstance.broadcastToChat) {
            chatSocketInstance.broadcastToChat(message.chat_id, {
                type: 'message_deleted',
                messageId,
                chatId: message.chat_id,
                timestamp: Date.now()
            });
        }
        
        console.log(`✅ [HTTP] Сообщение удалено: ${messageId}`);
        res.json({ 
            success: true, 
            message: 'Message deleted',
            deletedMessage 
        });
        
    } catch (error) {
        console.error('❌ [HTTP] Ошибка удаления сообщения:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

module.exports = {
    sendMessage,
    getChatMessages,
    getRecentMessages,
    deleteMessage,
    setChatSocket,
    extractParticipantIds
};
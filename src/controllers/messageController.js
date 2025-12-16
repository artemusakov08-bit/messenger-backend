const pool = require('../config/database');

let chatSocketInstance = null;

const setChatSocket = (socketInstance) => {
    chatSocketInstance = socketInstance;
};

const sendMessage = async (req, res) => {
    const connection = await pool.connect();
    
    try {
        await connection.query('BEGIN');
        
        const { chatId, text, senderId, senderName, type = 'text' } = req.body;
        
        if (!chatId || !text || !senderId || !senderName) {
            await connection.query('ROLLBACK');
            return res.status(400).json({
                error: 'Missing required fields: chatId, text, senderId, senderName'
            });
        }

        console.log(`📤 Отправка сообщения: чат=${chatId}, от=${senderId}`);

        // 1. СОЗДАЕМ ИЛИ ОБНОВЛЯЕМ ЧАТ
        const chatCheck = await connection.query(
            'SELECT id FROM chats WHERE id = $1',
            [chatId]
        );
        
        if (chatCheck.rows.length === 0) {
            // Получаем ID второго пользователя
            const parts = chatId.split('_');
            const otherUserId = parts.find(id => id !== senderId);
            
            let otherUserName = 'Приватный чат';
            
            if (otherUserId) {
                const userResult = await connection.query(
                    'SELECT display_name FROM users WHERE user_id = $1',
                    [otherUserId]
                );
                
                otherUserName = userResult.rows.length > 0 
                    ? userResult.rows[0].display_name 
                    : `User ${otherUserId.substring(otherUserId.length - 4)}`;
            }
            
            // СОЗДАЕМ ЧАТ
            await connection.query(
                `INSERT INTO chats (id, name, type, timestamp, last_message) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [chatId, otherUserName, 'private', Date.now(), text]
            );
            
            console.log(`✅ Чат создан: ${chatId} (${otherUserName})`);
            
        } else {
            // 🔥 КРИТИЧЕСКИ ВАЖНО: ОБНОВЛЯЕМ timestamp И last_message
            await connection.query(
                `UPDATE chats 
                 SET timestamp = $1, last_message = $2 
                 WHERE id = $3`,
                [Date.now(), text, chatId]
            );
            
            console.log(`🔄 Чат обновлен: ${chatId}`);
        }

        // 2. СОХРАНЯЕМ СООБЩЕНИЕ
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        
        const messageResult = await connection.query(
            `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, chat_id, text, sender_id, sender_name, timestamp, type`,
            [messageId, chatId, text, senderId, senderName, Date.now(), type]
        );

        const savedMessage = messageResult.rows[0];
        
        await connection.query('COMMIT');
        
        console.log(`✅ Сообщение сохранено: ${messageId}`);
        
        // 3. ОТПРАВЛЯЕМ ЧЕРЕЗ WEBSOCKET
        if (chatSocketInstance && chatSocketInstance.broadcastToChat) {
            console.log(`📤 Рассылка через WebSocket: ${chatId}`);
            
            chatSocketInstance.broadcastToChat(chatId, {
                type: 'new_message',
                chatId: savedMessage.chat_id,
                message: savedMessage,
                timestamp: Date.now()
            });
            
            // 🔥 УВЕДОМЛЯЕМ ОБ ОБНОВЛЕНИИ СПИСКА ЧАТОВ
            if (chatSocketInstance.notifyChatListUpdate) {
                chatSocketInstance.notifyChatListUpdate(chatId);
            }
        }
        
        res.status(201).json(savedMessage);
        
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

const getChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const { limit = 100, offset = 0, after } = req.query;
        
        console.log(`📥 Запрос сообщений для чата: ${chatId}`);
        
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
        
        console.log(`✅ Получено ${result.rows.length} сообщений для чата ${chatId}`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Ошибка получения сообщений:', error);
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
        
        console.log(`📥 Запрос последних сообщений для пользователя: ${userId}`);
        
        const result = await pool.query(
            `SELECT DISTINCT ON (m.chat_id) m.* 
             FROM messages m
             WHERE m.chat_id LIKE $1 OR m.chat_id LIKE $2 OR m.chat_id LIKE $3
             ORDER BY m.chat_id, m.timestamp DESC 
             LIMIT $4`,
            [`%${userId}%`, `${userId}_%`, `%_${userId}`, parseInt(limit)]
        );
        
        console.log(`✅ Получено ${result.rows.length} последних сообщений для ${userId}`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Ошибка получения последних сообщений:', error);
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
        
        console.log(`🗑️ Удаление сообщения: ${messageId} пользователем ${userId}`);
        
        const messageCheck = await pool.query(
            'SELECT sender_id, chat_id FROM messages WHERE id = $1',
            [messageId]
        );
        
        if (messageCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        const message = messageCheck.rows[0];
        
        if (message.sender_id !== userId) {
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
        
        console.log(`✅ Сообщение удалено: ${messageId}`);
        res.json({ 
            success: true, 
            message: 'Message deleted',
            deletedMessage 
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления сообщения:', error);
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
    setChatSocket
};
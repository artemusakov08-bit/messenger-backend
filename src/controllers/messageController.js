const pool = require('../config/database');
let chatSocket = null;

const setChatSocket = (socket) => {
    chatSocket = socket;
};


class MessageController {
    // Отправить сообщение
    async sendMessage(req, res) {
        console.log('📨 POST /api/messages - Body:', req.body);
        
        try {
            const { chatId, text, senderId, senderName, type = 'text' } = req.body;

            console.log('📝 Параметры:', { chatId, text, senderId, senderName });

            // Проверка обязательных полей
            if (!chatId || !text || !senderId || !senderName) { 
                console.log('❌ Отсутствуют обязательные поля');
                return res.status(400).json({ 
                    error: 'Missing required fields: chatId, text, senderId, senderName' 
                });
            }

        // ✅ ОТПРАВКА ЧЕРЕЗ WEBSOCKET
        if (chatSocket) {
            chatSocket.broadcastToChat(chatId, {
                type: 'new_message',
                chatId,
                message: savedMessage,
                timestamp: Date.now()
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

            res.json(savedMessage);
            
        } catch (error) {
            console.error('❌ Ошибка отправки сообщения:', error);
            res.status(500).json({ error: 'Internal server error: ' + error.message });
        }
    }

    // Получить сообщения чата
    async getChatMessages(req, res) {
        try {
            const { chatId } = req.params;
            const { limit = 100, offset = 0 } = req.query;
            
            console.log('💬 Getting messages for chat:', { chatId, limit, offset });

            const result = await pool.query(
                `SELECT * FROM messages 
                 WHERE chat_id = $1 
                 ORDER BY timestamp ASC 
                 LIMIT $2 OFFSET $3`,
                [chatId, parseInt(limit), parseInt(offset)]
            );

            console.log(`✅ Получено сообщений для чата ${chatId}: ${result.rows.length}`);
            res.json(result.rows);
            
        } catch (error) {
            console.error('❌ Ошибка получения сообщений:', error);
            res.status(500).json({ error: 'Internal server error: ' + error.message });
        }
    }

    // Получить последние сообщения
    async getRecentMessages(req, res) {
        try {
            const { userId } = req.params;
            const { limit = 20 } = req.query;
            
            console.log('💬 Getting recent messages for user:', userId);

            const result = await pool.query(
                `SELECT m.* 
                 FROM messages m
                 WHERE m.chat_id LIKE $1 OR m.chat_id LIKE $2 OR m.chat_id LIKE $3
                 ORDER BY m.timestamp DESC 
                 LIMIT $4`,
                [`%${userId}%`, `${userId}_%`, `%_${userId}`, parseInt(limit)]
            );

            console.log(`✅ Получено последних сообщений: ${result.rows.length}`);
            res.json(result.rows);
            
        } catch (error) {
            console.error('❌ Ошибка получения последних сообщений:', error);
            res.status(500).json({ error: 'Internal server error: ' + error.message });
        }
    }
}

module.exports = { sendMessage, getChatMessages, getRecentMessages, setChatSocket };
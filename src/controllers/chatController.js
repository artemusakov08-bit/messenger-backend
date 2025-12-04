const pool = require('../config/database');

class ChatController {
    // Получить чаты пользователя
    async getUserChats(req, res) {
        try {
            const { userId } = req.params;
            
            console.log('💬 Getting user chats:', userId);

            // Сначала получаем приватные чаты (из messages)
            const privateChatsQuery = `
                SELECT DISTINCT 
                    chat_id as id,
                    chat_name as name,
                    'private' as type,
                    last_message_time as timestamp,
                    last_message,
                    member_count
                FROM (
                    SELECT 
                        m.chat_id,
                        CASE 
                            WHEN u1.user_id = $1 THEN u2.display_name
                            ELSE u1.display_name
                        END as chat_name,
                        MAX(m.timestamp) as last_message_time,
                        (SELECT text FROM messages WHERE chat_id = m.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message,
                        2 as member_count
                    FROM messages m
                    LEFT JOIN users u1 ON u1.user_id = m.sender_id
                    LEFT JOIN users u2 ON u2.user_id = (
                        SELECT sender_id FROM messages 
                        WHERE chat_id = m.chat_id AND sender_id != $1 
                        LIMIT 1
                    )
                    WHERE m.chat_id LIKE $2 OR m.chat_id LIKE $3 OR m.chat_id LIKE $4
                    GROUP BY m.chat_id, u1.user_id, u2.user_id, u1.display_name, u2.display_name
                ) as chat_data
                ORDER BY timestamp DESC NULLS LAST
            `;

            const privateChatsResult = await pool.query(privateChatsQuery, [
                userId, 
                `%${userId}%`, 
                `${userId}_%`, 
                `%_${userId}`
            ]);

            // Затем получаем групповые чаты (из groups и group_members)
            const groupChatsQuery = `
                SELECT 
                    g.id,
                    g.name,
                    'group' as type,
                    COALESCE(
                        (SELECT MAX(timestamp) FROM messages WHERE chat_id = g.id),
                        g.created_at
                    ) as timestamp,
                    (SELECT text FROM messages WHERE chat_id = g.id ORDER BY timestamp DESC LIMIT 1) as last_message,
                    (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
                FROM groups g
                JOIN group_members gm ON g.id = gm.group_id
                WHERE gm.user_id = $1
                ORDER BY timestamp DESC NULLS LAST
            `;

            const groupChatsResult = await pool.query(groupChatsQuery, [userId]);

            // Объединяем результаты
            const allChats = [
                ...privateChatsResult.rows,
                ...groupChatsResult.rows
            ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            console.log(`✅ Found ${allChats.length} chats for user ${userId}`);
            
            res.json({
                success: true,
                chats: allChats
            });
            
        } catch (error) {
            console.error('❌ Error getting user chats:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка получения чатов: ' + error.message 
            });
        }
    }

    // Создать приватный чат
    async createPrivateChat(req, res) {
        try {
            const { userId1, userId2 } = req.body;
            
            console.log('💬 Creating private chat:', { userId1, userId2 });

            // Проверяем существование пользователей
            const user1 = await pool.query(
                'SELECT * FROM users WHERE user_id = $1',
                [userId1]
            );
            
            const user2 = await pool.query(
                'SELECT * FROM users WHERE user_id = $1',
                [userId2]
            );
            
            if (user1.rows.length === 0 || user2.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            // Создаем уникальный ID чата
            const chatId = [userId1, userId2].sort().join('_');
            
            // Получаем историю сообщений (пустой массив если чат новый)
            const messagesResult = await pool.query(
                `SELECT * FROM messages 
                 WHERE chat_id = $1 
                 ORDER BY timestamp ASC 
                 LIMIT 100`,
                [chatId]
            );

            res.json({
                success: true,
                chatId: chatId,
                user1: {
                    id: user1.rows[0].user_id,
                    displayName: user1.rows[0].display_name
                },
                user2: {
                    id: user2.rows[0].user_id,
                    displayName: user2.rows[0].display_name
                },
                messages: messagesResult.rows,
                messageCount: messagesResult.rows.length,
                isNew: messagesResult.rows.length === 0
            });
            
        } catch (error) {
            console.error('❌ Error creating private chat:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка создания чата: ' + error.message 
            });
        }
    }

    // Получить информацию о чате
    async getChat(req, res) {
        try {
            const { chatId } = req.params;
            
            console.log('💬 Getting chat:', chatId);

            // Получаем информацию о чате из сообщений
            const result = await pool.query(
                `SELECT 
                    m.chat_id,
                    CASE 
                        WHEN u1.user_id = $1 THEN u2.display_name
                        ELSE u1.display_name
                    END as chat_name,
                    'private' as type,
                    MAX(m.timestamp) as last_activity
                FROM messages m
                LEFT JOIN users u1 ON u1.user_id = m.sender_id
                LEFT JOIN users u2 ON u2.user_id != m.sender_id
                WHERE m.chat_id = $2
                GROUP BY m.chat_id, u1.user_id, u2.user_id, u1.display_name, u2.display_name
                LIMIT 1`,
                [req.userId, chatId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Чат не найден' 
                });
            }

            res.json({
                success: true,
                chat: result.rows[0]
            });
            
        } catch (error) {
            console.error('❌ Error getting chat:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка получения чата: ' + error.message 
            });
        }
    }
}

module.exports = new ChatController();
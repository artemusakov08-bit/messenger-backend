const pool = require('../config/database');

class ChatController {
    // 📱 ПОЛУЧИТЬ ЧАТЫ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
    async getUserChats(req, res) {
        try {
            const userId = req.user.user_id; // userId берется из middleware
            
            console.log('💬 Getting user chats for:', userId, req.user.display_name);

            // Сначала получаем приватные чаты (из messages)
            const privateChatsQuery = `
                SELECT DISTINCT 
                    chat_id as id,
                    chat_name as name,
                    'private' as type,
                    last_message_time as timestamp,
                    last_message,
                    member_count,
                    avatar_url
                FROM (
                    SELECT 
                        m.chat_id,
                        CASE 
                            WHEN u1.user_id = $1 THEN u2.display_name
                            ELSE u1.display_name
                        END as chat_name,
                        CASE 
                            WHEN u1.user_id = $1 THEN u2.profile_image
                            ELSE u1.profile_image
                        END as avatar_url,
                        MAX(m.timestamp) as last_message_time,
                        (SELECT text FROM messages WHERE chat_id = m.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message,
                        2 as member_count
                    FROM messages m
                    LEFT JOIN users u1 ON u1.user_id = m.sender_id
                    LEFT JOIN users u2 ON u2.user_id != m.sender_id
                    WHERE m.chat_id LIKE '%' || $1 || '%'
                    GROUP BY m.chat_id, u1.user_id, u2.user_id, u1.display_name, u2.display_name, u1.profile_image, u2.profile_image
                ) as chat_data
                ORDER BY timestamp DESC NULLS LAST
            `;

            const privateChatsResult = await pool.query(privateChatsQuery, [userId]);

            // Затем получаем групповые чаты (из groups и group_members)
            const groupChatsQuery = `
                SELECT 
                    g.id,
                    g.name,
                    'group' as type,
                    COALESCE(
                        (SELECT MAX(timestamp) FROM messages WHERE chat_id = g.id::text),
                        g.created_at
                    ) as timestamp,
                    (SELECT text FROM messages WHERE chat_id = g.id::text ORDER BY timestamp DESC LIMIT 1) as last_message,
                    (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
                    g.avatar as avatar_url
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

    // 👥 ПОЛУЧИТЬ ГРУППЫ (только в которых пользователь состоит)
    async getGroups(req, res) {
        try {
            const userId = req.user.user_id;
            
            const result = await pool.query(
                `SELECT g.*, gm.role as user_role
                 FROM groups g
                 JOIN group_members gm ON g.id = gm.group_id
                 WHERE gm.user_id = $1
                 ORDER BY g.created_at DESC`,
                [userId]
            );
            
            res.json({
                success: true,
                groups: result.rows
            });
        } catch (error) {
            console.error('❌ Error getting groups:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка получения групп' 
            });
        }
    }

    // 🔍 ПОИСК ГРУПП (доступных для вступления)
    async searchGroups(req, res) {
        try {
            const { query } = req.query;
            const userId = req.user.user_id;
            
            const result = await pool.query(
                `SELECT g.* 
                 FROM groups g
                 WHERE (g.name ILIKE $1 OR g.description ILIKE $1)
                 AND g.id NOT IN (
                     SELECT group_id FROM group_members WHERE user_id = $2
                 )
                 AND g.is_private = false
                 LIMIT 20`,
                [`%${query}%`, userId]
            );
            
            res.json({
                success: true,
                groups: result.rows
            });
        } catch (error) {
            console.error('❌ Error searching groups:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка поиска групп' 
            });
        }
    }

    // 💬 СОЗДАТЬ ПРИВАТНЫЙ ЧАТ
    async createPrivateChat(req, res) {
        try {
            const currentUserId = req.user.user_id;
            const { otherUserId } = req.body; // ID второго пользователя
            
            console.log('💬 Creating private chat:', { currentUserId, otherUserId });

            // Проверяем существование второго пользователя
            const userResult = await pool.query(
                'SELECT user_id, display_name, profile_image FROM users WHERE user_id = $1',
                [otherUserId]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            // Создаем уникальный ID чата
            const chatId = [currentUserId, otherUserId].sort().join('_');
            
            // Проверяем, есть ли уже сообщения в этом чате
            const messagesResult = await pool.query(
                `SELECT m.*, u.display_name as sender_name, u.profile_image as sender_avatar
                 FROM messages m
                 JOIN users u ON m.sender_id = u.user_id
                 WHERE m.chat_id = $1 
                 ORDER BY m.timestamp ASC 
                 LIMIT 100`,
                [chatId]
            );

            const otherUser = userResult.rows[0];
            
            res.json({
                success: true,
                chat: {
                    id: chatId,
                    name: otherUser.display_name,
                    type: 'private',
                    avatar: otherUser.profile_image,
                    memberCount: 2,
                    lastMessage: messagesResult.rows.length > 0 ? messagesResult.rows[messagesResult.rows.length - 1].text : null,
                    timestamp: messagesResult.rows.length > 0 ? messagesResult.rows[messagesResult.rows.length - 1].timestamp : new Date()
                },
                messages: messagesResult.rows,
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

    // ℹ️ ПОЛУЧИТЬ ИНФОРМАЦИЮ О ЧАТЕ
    async getChat(req, res) {
        try {
            const { chatId } = req.params;
            const userId = req.user.user_id;
            
            console.log('💬 Getting chat info:', chatId);

            // Проверяем тип чата (приватный или групповой)
            if (chatId.includes('_')) {
                // Приватный чат
                const userIds = chatId.split('_');
                const otherUserId = userIds.find(id => id !== userId);
                
                const userResult = await pool.query(
                    'SELECT user_id, display_name, profile_image, status FROM users WHERE user_id = $1',
                    [otherUserId]
                );
                
                if (userResult.rows.length === 0) {
                    return res.status(404).json({ 
                        success: false,
                        error: 'Чат не найден' 
                    });
                }
                
                const otherUser = userResult.rows[0];
                
                // Получаем последнее сообщение
                const lastMessageResult = await pool.query(
                    'SELECT text, timestamp FROM messages WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT 1',
                    [chatId]
                );
                
                res.json({
                    success: true,
                    chat: {
                        id: chatId,
                        name: otherUser.display_name,
                        type: 'private',
                        avatar: otherUser.profile_image,
                        memberCount: 2,
                        lastMessage: lastMessageResult.rows[0]?.text,
                        timestamp: lastMessageResult.rows[0]?.timestamp,
                        userStatus: otherUser.status
                    }
                });
            } else {
                // Групповой чат
                const groupResult = await pool.query(
                    `SELECT g.*, 
                            u.display_name as created_by_name,
                            COUNT(gm.user_id) as member_count
                     FROM groups g
                     LEFT JOIN users u ON g.created_by = u.user_id
                     LEFT JOIN group_members gm ON g.id = gm.group_id
                     WHERE g.id = $1 AND gm.user_id = $2
                     GROUP BY g.id, u.display_name`,
                    [chatId, userId]
                );
                
                if (groupResult.rows.length === 0) {
                    return res.status(404).json({ 
                        success: false,
                        error: 'Группа не найдена или у вас нет доступа' 
                    });
                }
                
                const group = groupResult.rows[0];
                res.json({
                    success: true,
                    chat: {
                        id: group.id,
                        name: group.name,
                        type: 'group',
                        avatar: group.avatar,
                        memberCount: parseInt(group.member_count),
                        description: group.description,
                        createdBy: group.created_by_name,
                        createdAt: group.created_at
                    }
                });
            }
            
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
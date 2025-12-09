const pool = require('../config/database');

class ChatController {
// 📱 ПОЛУЧИТЬ ЧАТЫ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ - ИСПРАВЛЕННЫЙ
async getUserChats(req, res) {
    try {
        const userId = req.user.user_id;
        console.log('💬 Getting user chats for:', userId);

        // 🔥 ЕДИНЫЙ ЗАПРОС ДЛЯ ВСЕХ ЧАТОВ
        const chatsQuery = `
            SELECT DISTINCT ON (chat_data.id) *
            FROM (
                -- 1. ЧАТЫ ИЗ ТАБЛИЦЫ CHATS
                SELECT 
                    c.id,
                    COALESCE(c.name, 'Приватный чат') as name,
                    COALESCE(c.type, 'private') as type,
                    COALESCE(c.timestamp, 0) as timestamp,
                    (SELECT text FROM messages WHERE chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message,
                    (SELECT COUNT(DISTINCT sender_id) FROM messages WHERE chat_id = c.id) as member_count,
                    COALESCE(
                        (SELECT profile_image FROM users WHERE user_id = (
                            SELECT CASE 
                                WHEN split_part(c.id, '_', 1) = $1 
                                THEN split_part(c.id, '_', 2)
                                ELSE split_part(c.id, '_', 1)
                            END
                        )),
                        ''
                    ) as avatar_url
                FROM chats c
                WHERE c.id LIKE '%' || $1 || '%'

                UNION ALL

                -- 2. ЧАТЫ ИЗ СООБЩЕНИЙ (если нет в таблице chats)
                SELECT 
                    m.chat_id as id,
                    COALESCE(
                        (SELECT display_name FROM users WHERE user_id = (
                            SELECT CASE 
                                WHEN split_part(m.chat_id, '_', 1) = $1 
                                THEN split_part(m.chat_id, '_', 2)
                                ELSE split_part(m.chat_id, '_', 1)
                            END
                        )),
                        'Пользователь'
                    ) as name,
                    'private' as type,
                    MAX(m.timestamp) as timestamp,
                    (SELECT text FROM messages WHERE chat_id = m.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message,
                    2 as member_count,
                    COALESCE(
                        (SELECT profile_image FROM users WHERE user_id = (
                            SELECT CASE 
                                WHEN split_part(m.chat_id, '_', 1) = $1 
                                THEN split_part(m.chat_id, '_', 2)
                                ELSE split_part(m.chat_id, '_', 1)
                            END
                        )),
                        ''
                    ) as avatar_url
                FROM messages m
                WHERE m.chat_id LIKE '%' || $1 || '%'
                  AND NOT EXISTS (SELECT 1 FROM chats WHERE id = m.chat_id)
                GROUP BY m.chat_id

                UNION ALL

                -- 3. ГРУППОВЫЕ ЧАТЫ
                SELECT 
                    g.id,
                    g.name,
                    'group' as type,
                    COALESCE(
                        (SELECT MAX(timestamp) FROM messages WHERE chat_id = g.id),
                        g.created_at
                    ) as timestamp,
                    (SELECT text FROM messages WHERE chat_id = g.id ORDER BY timestamp DESC LIMIT 1) as last_message,
                    (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
                    COALESCE(g.avatar, '') as avatar_url
                FROM groups g
                INNER JOIN group_members gm ON g.id = gm.group_id
                WHERE gm.user_id = $1
            ) as chat_data
            ORDER BY id, timestamp DESC
        `;

        const result = await pool.query(chatsQuery, [userId]);
        const chats = result.rows;

        // Сортируем по времени (самые новые сверху)
        chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Обновляем имена чатов
        for (const chat of chats) {
            if (chat.type === 'private' && (chat.name === 'Приватный чат' || !chat.name)) {
                const userIds = chat.id.split('_');
                const otherUserId = userIds.find(id => id !== userId);
                
                if (otherUserId) {
                    const userResult = await pool.query(
                        'SELECT display_name FROM users WHERE user_id = $1',
                        [otherUserId]
                    );
                    
                    if (userResult.rows.length > 0) {
                        chat.name = userResult.rows[0].display_name || `User ${otherUserId.slice(-4)}`;
                    }
                }
            }
        }

        console.log(`✅ Found ${chats.length} chats for user ${userId}`);
        
        res.json({
            success: true,
            chats: chats
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

    async saveChatToDatabase(chatId, userId1, userId2) {
        try {
            const pool = require('../config/database');
            
            // Проверяем, существует ли уже чат
            const existingChat = await pool.query(
                'SELECT id FROM chats WHERE id = $1',
                [chatId]
            );
            
            if (existingChat.rows.length === 0) {
                // Создаем новый чат
                const chatName = `Чат ${userId1.slice(-4)}-${userId2.slice(-4)}`;
                
                await pool.query(
                    'INSERT INTO chats (id, name, type, timestamp) VALUES ($1, $2, $3, $4)',
                    [chatId, chatName, 'private', Date.now()]
                );
                
                console.log('✅ Чат сохранен в базу:', chatId);
            }
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка сохранения чата:', error);
            return false;
        }
    }

// 💬 СОЗДАТЬ/ПОЛУЧИТЬ ПРИВАТНЫЙ ЧАТ 
async createPrivateChat(req, res) {
    try {
        const { userId1, userId2 } = req.body;
        const currentUserId = req.user.user_id;
        
        // Проверяем что текущий пользователь участник чата
        if (currentUserId !== userId1 && currentUserId !== userId2) {
            return res.status(403).json({ 
                success: false,
                error: 'Вы не можете создавать чат без участия' 
            });
        }

        // Создаем ID чата
        const sortedIds = [userId1, userId2].sort();
        const chatId = sortedIds.join('_');
        
        // Получаем информацию о втором пользователе
        const otherUserId = userId1 === currentUserId ? userId2 : userId1;
        const userResult = await pool.query(
            'SELECT display_name, profile_image FROM users WHERE user_id = $1',
            [otherUserId]
        );
        
        const otherUser = userResult.rows[0] || { display_name: 'Пользователь', profile_image: null };
        
        // 🔥 ГАРАНТИРОВАННО СОЗДАЕМ ЧАТ В ТАБЛИЦЕ CHATS
        const chatCheck = await pool.query(
            'SELECT id FROM chats WHERE id = $1',
            [chatId]
        );
        
        if (chatCheck.rows.length === 0) {
            await pool.query(
                'INSERT INTO chats (id, name, type, timestamp) VALUES ($1, $2, $3, $4)',
                [chatId, otherUser.display_name, 'private', Date.now()]
            );
            console.log('✅ Чат создан в базе:', chatId);
        } else {
            // Обновляем время последней активности
            await pool.query(
                'UPDATE chats SET timestamp = $1 WHERE id = $2',
                [Date.now(), chatId]
            );
        }

        // Получаем сообщения
        const messagesResult = await pool.query(
            `SELECT * FROM messages 
             WHERE chat_id = $1 
             ORDER BY timestamp ASC 
             LIMIT 100`,
            [chatId]
        );

        // Получаем информацию о чате
        const chatInfo = await pool.query(
            'SELECT * FROM chats WHERE id = $1',
            [chatId]
        );

        res.json({
            success: true,
            chat: {
                id: chatId,
                name: otherUser.display_name,
                type: 'private',
                timestamp: Date.now(),
                avatar_url: otherUser.profile_image,
                last_message: messagesResult.rows.length > 0 ? messagesResult.rows[messagesResult.rows.length - 1].text : null
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
const pool = require('../config/database');

class ChatController {
    // 📱 ПОЛУЧИТЬ ЧАТЫ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
async getUserChats(req, res) {
    try {
        const userId = req.user.user_id;
        console.log('💬 Getting user chats for user:', userId);

        // 🔥 1. Получаем все уникальные чаты
        const messagesQuery = `
            SELECT DISTINCT 
                chat_id,
                MAX(timestamp) as last_message_time
            FROM messages 
            WHERE chat_id LIKE '%' || $1 || '%'
            GROUP BY chat_id
        `;
        
        const messagesResult = await pool.query(messagesQuery, [userId]);
        console.log(`📨 Found ${messagesResult.rows.length} chat IDs from messages`);
        
        let allChats = [];
        
        // 🔥 2. Обрабатываем каждый чат
        for (const row of messagesResult.rows) {
            const chatId = row.chat_id;
            
            try {
                // Проверяем есть ли чат в таблице chats
                const chatResult = await pool.query(
                    'SELECT id, name, type, timestamp FROM chats WHERE id = $1',
                    [chatId]
                );
                
                let chatName = 'Приватный чат';
                let chatTimestamp = row.last_message_time || Date.now();
                
                if (chatResult.rows.length > 0) {
                    // Чат есть в таблице chats
                    const dbChat = chatResult.rows[0];
                    chatName = dbChat.name || 'Приватный чат';
                    chatTimestamp = dbChat.timestamp || row.last_message_time;
                } else {
                    // 🔥 ВАЖНО: Если чата нет в таблице chats, но есть сообщения - создаем его
                    console.log(`⚠️  Chat ${chatId} not in chats table, creating...`);
                    
                    // Получаем ID второго пользователя
                    const parts = chatId.split('_');
                    let otherUserId = null;
                    
                    for (const part of parts) {
                        if (part !== userId) {
                            otherUserId = part;
                            break;
                        }
                    }
                    
                    // Получаем имя другого пользователя
                    if (otherUserId) {
                        const userResult = await pool.query(
                            'SELECT display_name FROM users WHERE user_id = $1',
                            [otherUserId]
                        );
                        
                        if (userResult.rows.length > 0) {
                            chatName = userResult.rows[0].display_name || `User ${otherUserId.slice(-4)}`;
                        }
                    }
                    
                    // 🔥 СОЗДАЕМ ЧАТ В ТАБЛИЦЕ CHATS
                    await pool.query(
                        'INSERT INTO chats (id, name, type, timestamp) VALUES ($1, $2, $3, $4)',
                        [chatId, chatName, 'private', chatTimestamp]
                    );
                    console.log(`✅ Chat created in DB: ${chatId} (${chatName})`);
                }
                
                // 🔥 3. Получаем последнее сообщение
                const lastMessageResult = await pool.query(
                    'SELECT text FROM messages WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT 1',
                    [chatId]
                );
                
                let lastMessage = '';
                if (lastMessageResult.rows.length > 0) {
                    lastMessage = lastMessageResult.rows[0].text;
                }
                
                // 🔥 4. Формируем объект чата
                allChats.push({
                    id: chatId,
                    name: chatName,
                    type: 'private',
                    timestamp: chatTimestamp,
                    last_message: lastMessage,
                    member_count: 2
                });
                
            } catch (error) {
                console.error(`❌ Error processing chat ${row.chat_id}:`, error.message);
            }
        }
        
        // 🔥 5. Также добавляем чаты из таблицы chats (на случай если нет сообщений)
        const directChatsQuery = `
            SELECT id, name, type, timestamp 
            FROM chats 
            WHERE id LIKE '%' || $1 || '%'
        `;
        
        const directChatsResult = await pool.query(directChatsQuery, [userId]);
        
        for (const chat of directChatsResult.rows) {
            // Проверяем нет ли уже такого чата в списке
            const existingChat = allChats.find(c => c.id === chat.id);
            if (!existingChat) {
                // Получаем последнее сообщение
                const lastMessageResult = await pool.query(
                    'SELECT text FROM messages WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT 1',
                    [chat.id]
                );
                
                let lastMessage = '';
                if (lastMessageResult.rows.length > 0) {
                    lastMessage = lastMessageResult.rows[0].text;
                }
                
                allChats.push({
                    id: chat.id,
                    name: chat.name,
                    type: chat.type,
                    timestamp: chat.timestamp,
                    last_message: lastMessage,
                    member_count: 2
                });
            }
        }
        
        // 🔥 6. Сортируем по времени (новые сверху)
        allChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        console.log(`✅ Total ${allChats.length} chats for user ${userId}`);
        
        // 🔥 7. Логируем для отладки
        allChats.forEach((chat, i) => {
            const shortLastMsg = chat.last_message 
                ? (chat.last_message.length > 30 ? chat.last_message.substring(0, 30) + '...' : chat.last_message)
                : 'нет сообщений';
            console.log(`${i+1}. ${chat.id} - "${chat.name}" - last: "${shortLastMsg}"`);
        });
        
        // 🔥 8. Отдаем результат
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

    // 💬 СОЗДАТЬ ПРИВАТНЫЙ ЧАТ
    async createPrivateChat(req, res) {
        try {
            console.log('🔥 createPrivateChat вызван');
            console.log('📥 Request body:', req.body);
            console.log('👤 User from token:', req.user);
            
            const { userId1, userId2 } = req.body;
            const currentUserId = req.user.user_id;
            
            const actualUserId1 = currentUserId;
            const actualUserId2 = userId2;
            
            console.log('👥 Участники чата:', {
                fromToken: currentUserId,
                fromBody: userId1,
                otherUser: userId2,
                actualUser1: actualUserId1,
                actualUser2: actualUserId2
            });
            
            if (!actualUserId2) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Не указан ID второго пользователя' 
                });
            }
            
            if (actualUserId1 === actualUserId2) {
                console.error('❌ ОШИБКА: Пытаешься создать чат с самим собой!');
                console.error('❌ Текущий пользователь:', actualUserId1);
                console.error('❌ Второй пользователь:', actualUserId2);
                return res.status(400).json({ 
                    success: false,
                    error: 'Нельзя создать чат с самим собой' 
                });
            }
            
            console.log('👥 Создание чата между:', actualUserId1, 'и', actualUserId2);
            
            // Создаем ID чата
            const sortedIds = [actualUserId1, actualUserId2].sort();
            const chatId = sortedIds.join('_');
            
            console.log('🆔 Chat ID:', chatId);
            
            // Получаем информацию о втором пользователе
            const userResult = await pool.query(
                'SELECT display_name FROM users WHERE user_id = $1',
                [actualUserId2]
            );
            
            let otherUserName = `User ${actualUserId2.slice(-4)}`;
            if (userResult.rows.length > 0) {
                otherUserName = userResult.rows[0].display_name || otherUserName;
            }
            
            // 🔥 Проверяем существование чата
            const chatCheck = await pool.query(
                'SELECT id, name, type, timestamp FROM chats WHERE id = $1',
                [chatId]
            );
            
            let isNewChat = false;
            
            // Если чата нет - создаем
            if (chatCheck.rows.length === 0) {
                await pool.query(
                    'INSERT INTO chats (id, name, type, timestamp) VALUES ($1, $2, $3, $4)',
                    [chatId, otherUserName, 'private', Date.now()]
                );
                console.log('✅ Chat created:', chatId);
                isNewChat = true;
            } else {
                // Обновляем время последней активности
                await pool.query(
                    'UPDATE chats SET timestamp = $1 WHERE id = $2',
                    [Date.now(), chatId]
                );
                console.log('🔄 Chat updated:', chatId);
            }
            
            // Получаем сообщения (если есть)
            const messagesResult = await pool.query(
                `SELECT * FROM messages 
                WHERE chat_id = $1 
                ORDER BY timestamp ASC 
                LIMIT 100`,
                [chatId]
            );
            
            // Получаем актуальную информацию о чате
            const updatedChatResult = await pool.query(
                'SELECT id, name, type, timestamp FROM chats WHERE id = $1',
                [chatId]
            );
            
            const chat = updatedChatResult.rows[0] || {
                id: chatId,
                name: otherUserName,
                type: 'private',
                timestamp: Date.now()
            };
            
            // Последнее сообщение
            let lastMessage = null;
            if (messagesResult.rows.length > 0) {
                lastMessage = messagesResult.rows[messagesResult.rows.length - 1].text;
            }
            
            res.json({
                success: true,
                chatId: chatId,
                chat: {
                    id: chat.id,
                    name: chat.name,
                    type: chat.type,
                    timestamp: chat.timestamp,
                    last_message: lastMessage
                },
                messages: messagesResult.rows,
                messageCount: messagesResult.rows.length,
                isNew: isNewChat
            });
            
        } catch (error) {
            console.error('❌ Error creating private chat:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка создания чата: ' + error.message 
            });
        }
    }

    // 👥 ПОЛУЧИТЬ ГРУППЫ
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

    // 🔍 ПОИСК ГРУПП
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

    // ℹ️ ПОЛУЧИТЬ ИНФОРМАЦИЮ О ЧАТЕ
    async getChat(req, res) {
        try {
            const { chatId } = req.params;
            const userId = req.user.user_id;
            
            console.log('💬 Getting chat info:', chatId);

            // Приватный чат
            if (chatId.includes('_')) {
                const userIds = chatId.split('_');
                const otherUserId = userIds.find(id => id !== userId);
                
                const userResult = await pool.query(
                    'SELECT user_id, display_name, status FROM users WHERE user_id = $1',
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

    // 💾 СОХРАНИТЬ ЧАТ В БАЗУ ДАННЫХ
    async saveChatToDatabase(chatId, userId1, userId2) {
        try {
            // Проверяем, существует ли уже чат
            const existingChat = await pool.query(
                'SELECT id FROM chats WHERE id = $1',
                [chatId]
            );
            
            if (existingChat.rows.length === 0) {
                const chatName = `Чат ${userId1.slice(-4)}-${userId2.slice(-4)}`;
                
                await pool.query(
                    'INSERT INTO chats (id, name, type, timestamp) VALUES ($1, $2, $3, $4)',
                    [chatId, chatName, 'private', Date.now()]
                );
                
                console.log('✅ Чат сохранен в базу:', chatId);
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка сохранения чата:', error);
            return false;
        }
    }
}

module.exports = new ChatController();
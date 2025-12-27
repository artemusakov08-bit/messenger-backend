const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

class ChatSocket {
    constructor(wss) {
        this.wss = wss;
        this.userConnections = new Map(); // userId -> Set(WebSocket)
        this.chatSubscriptions = new Map(); // chatId -> Set(userId)
        this.userChats = new Map(); // userId -> Set(chatId)
        this.setupConnection();
    }

    setupConnection() {
        this.wss.on('connection', (ws, request) => {
            console.log('🔌 Новое WebSocket подключение');
            
            let userId = null;
            let userChats = new Set();
            
            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log(`📨 WS сообщение от ${userId || 'anonymous'}:`, message.type);
                    
                    switch (message.type) {
                        case 'authenticate':
                            userId = await this.handleAuthentication(ws, message.token);
                            if (userId) {
                                userChats = await this.loadUserChats(userId);
                                this.subscribeToUserChats(userId, userChats, ws);
                            }
                            break;
                            
                        case 'join_chat':
                            if (userId) {
                                await this.handleJoinChat(userId, message.chatId, ws);
                                userChats.add(message.chatId);
                            }
                            break;
                            
                        case 'leave_chat':
                            if (userId) {
                                this.handleLeaveChat(userId, message.chatId, ws);
                                userChats.delete(message.chatId);
                            }
                            break;
                            
                        case 'send_message':
                            if (userId) {
                                await this.handleSendMessage(userId, message);
                            }
                            break;
                            
                        case 'typing':
                            if (userId && message.chatId) {
                                this.handleTyping(userId, message.chatId, message.isTyping);
                            }
                            break;
                            
                        case 'message_read':
                            if (userId && message.messageId && message.chatId) {
                                await this.handleMessageRead(userId, message.messageId, message.chatId);
                            }
                            break;
                            
                        case 'ping':
                            ws.send(JSON.stringify({ 
                                type: 'pong', 
                                timestamp: Date.now(),
                                userId 
                            }));
                            break;
                            
                        default:
                            console.warn(`⚠️ Неизвестный тип сообщения: ${message.type}`);
                    }
                } catch (error) {
                    console.error('❌ Ошибка обработки WS сообщения:', error);
                    this.sendError(ws, error.message);
                }
            });

            ws.on('close', () => {
                console.log(`🔌 Закрыто соединение ${userId ? `для ${userId}` : 'anonymous'}`);
                if (userId) {
                    this.handleDisconnect(userId, ws);
                    this.unsubscribeFromAllChats(userId, ws);
                }
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket ошибка:', error);
            });
        });
    }

    async handleAuthentication(ws, token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userId = decoded.userId;
            
            // Добавляем соединение для пользователя
            if (!this.userConnections.has(userId)) {
                this.userConnections.set(userId, new Set());
            }
            this.userConnections.get(userId).add(ws);
            
            // Сохраняем userId в объекте WebSocket
            ws.userId = userId;
            
            console.log(`✅ Аутентифицирован пользователь: ${userId}`);
            
            ws.send(JSON.stringify({
                type: 'authenticated',
                userId,
                timestamp: Date.now()
            }));
            
            return userId;
            
        } catch (error) {
            console.error('❌ Ошибка аутентификации:', error);
            ws.send(JSON.stringify({
                type: 'auth_error',
                message: 'Invalid or expired token'
            }));
            ws.close();
            return null;
        }
    }

    async loadUserChats(userId) {
        try {
            const result = await pool.query(
                `SELECT id FROM chats 
                 WHERE id LIKE $1 OR id LIKE $2 OR id LIKE $3`,
                [`%${userId}%`, `${userId}_%`, `%_${userId}`]
            );
            
            const userChats = new Set();
            result.rows.forEach(row => userChats.add(row.id));
            
            console.log(`📋 Пользователь ${userId} состоит в ${userChats.size} чатах`);
            return userChats;
            
        } catch (error) {
            console.error('❌ Ошибка загрузки чатов пользователя:', error);
            return new Set();
        }
    }

    subscribeToUserChats(userId, userChats, ws) {
        userChats.forEach(chatId => {
            this.subscribeToChat(userId, chatId);
            
            // Отправляем уведомление о подписке
            ws.send(JSON.stringify({
                type: 'subscribed_to_chat',
                chatId,
                timestamp: Date.now()
            }));
        });
    }

    async handleJoinChat(userId, chatId, ws) {
        try {
            // Проверяем, имеет ли пользователь доступ к чату
            if (!chatId.includes(userId)) {
                throw new Error(`User ${userId} has no access to chat ${chatId}`);
            }
            
            await this.ensureChatExists(chatId, userId);
            
            this.subscribeToChat(userId, chatId);
            
            // Отправляем подтверждение
            ws.send(JSON.stringify({
                type: 'joined_chat',
                chatId,
                timestamp: Date.now()
            }));
            
            console.log(`✅ Пользователь ${userId} присоединился к чату ${chatId}`);
            
        } catch (error) {
            console.error(`❌ Ошибка присоединения к чату ${chatId}:`, error);
            this.sendError(ws, error.message);
        }
    }

    subscribeToChat(userId, chatId) {
        // Добавляем чат в подписки пользователя
        if (!this.userChats.has(userId)) {
            this.userChats.set(userId, new Set());
        }
        this.userChats.get(userId).add(chatId);
        
        // Добавляем пользователя в подписчики чата
        if (!this.chatSubscriptions.has(chatId)) {
            this.chatSubscriptions.set(chatId, new Set());
        }
        this.chatSubscriptions.get(chatId).add(userId);
    }

    handleLeaveChat(userId, chatId, ws) {
        // Удаляем из подписок чата
        if (this.chatSubscriptions.has(chatId)) {
            this.chatSubscriptions.get(chatId).delete(userId);
        }
        
        // Удаляем из чатов пользователя
        if (this.userChats.has(userId)) {
            this.userChats.get(userId).delete(chatId);
        }
        
        console.log(`🔗 Пользователь ${userId} покинул чат ${chatId}`);
        
        ws.send(JSON.stringify({
            type: 'left_chat',
            chatId,
            timestamp: Date.now()
        }));
    }

    async handleSendMessage(userId, messageData) {
        try {
            const { chatId, text, type = 'text', senderName } = messageData;
            
            console.log(`📤 ${userId} отправляет сообщение в ${chatId}`);

            await this.updateChatTimestamp(chatId, text);
            
            console.log(`📤 ${userId} отправляет сообщение в ${chatId}: "${text.substring(0, 50)}..."`);
            
            // Проверяем доступ к чату
            if (!chatId.includes(userId)) {
                throw new Error(`User ${userId} has no access to chat ${chatId}`);
            }
            
            await this.ensureChatExists(chatId, userId);
            
            // Сохраняем в БД
            const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const result = await pool.query(
                `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [messageId, chatId, text, userId, senderName || 'User', Date.now(), type]
            );

            const savedMessage = result.rows[0];
            
            // Обновляем таймстамп чата
            await pool.query(
                'UPDATE chats SET timestamp = $1 WHERE id = $2',
                [Date.now(), chatId]
            );
            
            // Подготавливаем данные для отправки
            const messageForClients = {
                type: 'new_message',
                chatId,
                message: savedMessage,
                timestamp: Date.now()
            };
            
            // Отправляем сообщение всем подписанным на чат
            this.broadcastToChat(chatId, messageForClients, userId);
            
            // Отправляем подтверждение отправителю
            this.sendToUser(userId, {
                type: 'message_sent',
                messageId,
                chatId,
                status: 'delivered',
                timestamp: Date.now()
            });
            
            // Уведомляем об обновлении списка чатов
            this.notifyChatListUpdate(chatId);
            
            console.log(`✅ Сообщение ${messageId} доставлено в чат ${chatId}`);
            
        } catch (error) {
            console.error('❌ Ошибка отправки сообщения через WS:', error);
            this.sendToUser(userId, {
                type: 'message_error',
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    getChatParticipants(chatId) {
        try {
            const parts = chatId.split('_');
            
            if (parts.length < 4) {
                console.error('❌ Неверный формат chatId:', chatId);
                return [];
            }
            
            const user1 = parts[0] + '_' + parts[1];  
            const user2 = parts[2] + '_' + parts[3];  
            
            return [user1, user2];
        } catch (error) {
            console.error('❌ Ошибка разбора chatId:', error);
            return [];
        }
    }

    async updateChatTimestamp(chatId, lastMessage = null) {
        try {
            const pool = require('../config/database');
            
            const chatCheck = await pool.query(
                'SELECT id FROM chats WHERE id = $1',
                [chatId]
            );
            
            if (chatCheck.rows.length === 0) {
                // Если чата нет, получаем участников и создаем
                const parts = chatId.split('_');
                const [userId1, userId2] = parts;
                
                // Получаем имя второго пользователя
                const userResult = await pool.query(
                    'SELECT display_name FROM users WHERE user_id = $1',
                    [userId2]
                );
                
                const chatName = userResult.rows.length > 0 
                    ? userResult.rows[0].display_name 
                    : `User ${userId2.slice(-4)}`;
                
                await pool.query(
                    `INSERT INTO chats (id, name, type, timestamp, last_message) 
                    VALUES ($1, $2, $3, $4, $5)`,
                    [chatId, chatName, 'private', Date.now(), lastMessage]
                );
            } else {
                // Обновляем существующий чат
                const updateQuery = lastMessage 
                    ? `UPDATE chats SET timestamp = $1, last_message = $2 WHERE id = $3`
                    : `UPDATE chats SET timestamp = $1 WHERE id = $2`;
                
                const params = lastMessage 
                    ? [Date.now(), lastMessage, chatId]
                    : [Date.now(), chatId];
                    
                await pool.query(updateQuery, params);
            }
            
            console.log(`✅ Чат ${chatId} обновлен`);
            
        } catch (error) {
            console.error(`❌ Ошибка обновления чата ${chatId}:`, error);
        }
    }

    async ensureChatExists(chatId, senderId) {
        try {
            // Проверяем существование чата
            const chatResult = await pool.query(
                'SELECT id FROM chats WHERE id = $1',
                [chatId]
            );
            
            if (chatResult.rows.length === 0) {
                // Получаем ID участников
                const userIds = chatId.split('_');
                const otherUserId = userIds.find(id => id !== senderId);
                
                if (!otherUserId) {
                    throw new Error(`Cannot find other user in chat: ${chatId}`);
                }
                
                // Получаем имя другого пользователя
                const userResult = await pool.query(
                    'SELECT display_name FROM users WHERE user_id = $1',
                    [otherUserId]
                );
                
                const otherUserName = userResult.rows.length > 0 
                    ? userResult.rows[0].display_name 
                    : `User ${otherUserId.slice(-4)}`;
                
                // Создаем чат
                await pool.query(
                    'INSERT INTO chats (id, name, type, timestamp) VALUES ($1, $2, $3, $4)',
                    [chatId, otherUserName, 'private', Date.now()]
                );
                
                console.log(`✅ Чат создан через WS: ${chatId} (${otherUserName})`);
                
                // Уведомляем участников о создании чата
                this.broadcastToChat(chatId, {
                    type: 'chat_created',
                    chatId,
                    chatName: otherUserName,
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            console.error('❌ Ошибка проверки чата:', error);
            throw error;
        }
    }

    handleTyping(userId, chatId, isTyping) {
        const typingMessage = {
            type: isTyping ? 'user_typing' : 'user_stopped_typing',
            chatId,
            userId,
            timestamp: Date.now()
        };
        
        // Отправляем всем в чате, кроме отправителя
        this.broadcastToChat(chatId, typingMessage, userId);
    }

    async handleMessageRead(userId, messageId, chatId) {
        try {
            // Обновляем статус прочтения в БД
            await pool.query(
                'UPDATE messages SET read = true WHERE id = $1 AND chat_id = $2',
                [messageId, chatId]
            );
            
            // Уведомляем отправителя о прочтении
            const messageResult = await pool.query(
                'SELECT sender_id FROM messages WHERE id = $1',
                [messageId]
            );
            
            if (messageResult.rows.length > 0) {
                const senderId = messageResult.rows[0].sender_id;
                
                if (senderId !== userId) {
                    this.sendToUser(senderId, {
                        type: 'message_read',
                        messageId,
                        chatId,
                        readerId: userId,
                        timestamp: Date.now()
                    });
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка обработки прочтения сообщения:', error);
        }
    }

    broadcastToChat(chatId, data, excludeUserId = null) {
        console.log(`🔥 Рассылка в чат ${chatId}, исключая: ${excludeUserId}`);
        
        // 1. Отправляем подписчикам
        if (this.chatSubscriptions.has(chatId)) {
            const subscribers = this.chatSubscriptions.get(chatId);
            console.log(`🔥 Подписчики чата:`, Array.from(subscribers));
            
            subscribers.forEach(userId => {
                if (userId !== excludeUserId) {
                    this.sendToUser(userId, data);
                }
            });
        }
        
        // 2. Также отправляем участникам чата (на случай если не подписаны)
        const participants = this.getChatParticipants(chatId);
        console.log(`🔥 Участники чата:`, participants);
        
        participants.forEach(userId => {
            if (userId !== excludeUserId) {
                this.sendToUser(userId, data);
            }
        });
    }
    
    notifyChatListUpdate(chatId) {
        try {
            // Используем правильный метод для получения участников
            const participants = this.getChatParticipants(chatId);
            
            console.log(`🔥 Уведомляем участников чата ${chatId}:`, participants);
            
            participants.forEach(userId => {
                // Проверяем подключение пользователя
                const userConnections = this.userConnections.get(userId);
                
                if (userConnections && userConnections.size > 0) {
                    console.log(`✅ Пользователь ${userId} онлайн, отправляем уведомление`);
                    
                    userConnections.forEach(ws => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'chat_updated',
                                chatId,
                                action: 'new_message',
                                timestamp: Date.now()
                            }));
                        }
                    });
                } else {
                    console.log(`⚠️ Пользователь ${userId} не онлайн, уведомление не отправлено`);
                }
            });
        } catch (error) {
            console.error('❌ Ошибка уведомления об обновлении чата:', error);
        }
    }
    
    notifyChatCreated(chatId, chatName, participants) {
        try {
            const message = {
                type: 'chat_created',
                chatId,
                chatName,
                participants,
                timestamp: Date.now()
            };
            
            participants.forEach(userId => {
                this.sendToUser(userId, message);
            });
            
            console.log(`✅ Уведомление о создании чата отправлено: ${chatId}`);
        } catch (error) {
            console.error('❌ Ошибка уведомления о создании чата:', error);
        }
    }
    
    sendToUser(userId, data) {
        try {
            console.log(`🔥 Отправка пользователю ${userId}:`, data.type);
            
            const userConnections = this.userConnections.get(userId);
            
            if (!userConnections || userConnections.size === 0) {
                console.log(`⚠️ Пользователь ${userId} не имеет активных WebSocket соединений`);
                return false;
            }
            
            let sentCount = 0;
            userConnections.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(data));
                    sentCount++;
                    console.log(`✅ Сообщение отправлено пользователю ${userId}`);
                } else {
                    console.log(`⚠️ WebSocket пользователя ${userId} не в состоянии OPEN: ${ws.readyState}`);
                }
            });
            
            console.log(`📊 Пользователю ${userId} отправлено ${sentCount} сообщений`);
            return sentCount > 0;
            
        } catch (error) {
            console.error(`❌ Ошибка отправки пользователю ${userId}:`, error);
            return false;
        }
    }

    handleDisconnect(userId, ws) {
        // Удаляем конкретное соединение
        if (this.userConnections.has(userId)) {
            this.userConnections.get(userId).delete(ws);
            
            // Если больше нет соединений, удаляем пользователя
            if (this.userConnections.get(userId).size === 0) {
                this.userConnections.delete(userId);
                this.userChats.delete(userId);
            }
        }
        
        console.log(`👋 Пользователь ${userId} отключился`);
    }

    unsubscribeFromAllChats(userId, ws) {
        // Удаляем пользователя из всех подписок чатов
        this.chatSubscriptions.forEach((subscribers, chatId) => {
            subscribers.delete(userId);
        });
    }

    sendError(ws, message) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message,
                    timestamp: Date.now()
                }));
            }
        } catch (error) {
            console.error('❌ Ошибка отправки ошибки:', error);
        }
    }
    
    // 🔥 Метод для проверки состояния (можно использовать для дебага)
    getStats() {
        return {
            totalUsers: this.userConnections.size,
            totalChats: this.chatSubscriptions.size,
            userConnections: Array.from(this.userConnections.entries()).map(([userId, connections]) => ({
                userId,
                connectionCount: connections.size
            })),
            chatSubscriptions: Array.from(this.chatSubscriptions.entries()).map(([chatId, subscribers]) => ({
                chatId,
                subscriberCount: subscribers.size,
                subscribers: Array.from(subscribers)
            }))
        };
    }
}

module.exports = ChatSocket;
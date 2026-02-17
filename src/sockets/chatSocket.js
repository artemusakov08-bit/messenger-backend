const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const SessionService = require('../services/sessionService');

class ChatSocket {
    constructor(wss) {
        this.wss = wss;
        this.userConnections = new Map(); // userId (numeric) -> Set(WebSocket)
        this.chatSubscriptions = new Map(); // chatId -> Set(userId numeric)
        this.userChats = new Map(); // userId (numeric) -> Set(chatId)
        this.setupConnection();
        
        // Периодическая очистка мертвых соединений
        setInterval(() => this.cleanupDeadConnections(), 30000);
    }

    setupConnection() {
        this.wss.on('connection', (ws, request) => {
            console.log('🔌 Новое WebSocket подключение');
            
            let userId = null;
            let userChats = new Set();
            let isAuthenticated = false;
            
            // Устанавливаем таймаут на аутентификацию
            const authTimeout = setTimeout(() => {
                if (!isAuthenticated) {
                    console.log('⏰ Таймаут аутентификации');
                    ws.close(1008, 'Authentication timeout');
                }
            }, 10000);
            
            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log(`📨 WS сообщение ${message.type}`, {
                        from: userId || 'anonymous',
                        chat: message.chatId || 'none'
                    });
                    
                    switch (message.type) {
                        case 'authenticate':
                            clearTimeout(authTimeout);
                            const authResult = await this.handleAuthentication(ws, message.token);
                            if (authResult.userId) {
                                userId = authResult.userId;
                                isAuthenticated = authResult.authenticated;
                                if (isAuthenticated) {
                                    userChats = await this.loadUserChats(userId);
                                    this.subscribeToUserChats(userId, userChats, ws);
                                }
                            }
                            break;
                            
                        case 'refresh_token':
                            console.log('🔄 Запрос обновления токена через WS');
                            await this.handleTokenRefresh(ws, message.refreshToken, message.ip);
                            break;
                            
                        case 'reauthenticate':
                            console.log('🔐 Повторная аутентификация через WS');
                            if (message.accessToken) {
                                const authResult = await this.handleAuthentication(ws, message.accessToken);
                                if (authResult.userId && authResult.authenticated) {
                                    userId = authResult.userId;
                                    isAuthenticated = true;
                                    ws.send(JSON.stringify({
                                        type: 'reauthenticated',
                                        userId: userId,
                                        timestamp: Date.now()
                                    }));
                                }
                            }
                            break;
                            
                        case 'join_chat':
                            if (userId && isAuthenticated) {
                                await this.handleJoinChat(userId, message.chatId, ws);
                                userChats.add(message.chatId);
                            } else if (userId && !isAuthenticated) {
                                this.sendError(ws, 'Требуется повторная аутентификация. Токен истек.', 'TOKEN_EXPIRED');
                            } else {
                                this.sendError(ws, 'Требуется аутентификация', 'AUTH_REQUIRED');
                            }
                            break;
                            
                        case 'leave_chat':
                            if (userId && isAuthenticated) {
                                this.handleLeaveChat(userId, message.chatId, ws);
                                userChats.delete(message.chatId);
                            }
                            break;
                            
                        case 'send_message':
                            if (userId && isAuthenticated) {
                                await this.handleSendMessage(userId, message);
                            } else if (userId && !isAuthenticated) {
                                this.sendToUser(userId, {
                                    type: 'message_error',
                                    error: 'Токен истек. Обновите токен и отправьте сообщение снова.',
                                    code: 'TOKEN_EXPIRED',
                                    originalMessage: message,
                                    timestamp: Date.now()
                                });
                            }
                            break;
                            
                        case 'typing':
                            if (userId && isAuthenticated && message.chatId) {
                                this.handleTyping(userId, message.chatId, message.isTyping);
                            }
                            break;
                            
                        case 'message_read':
                            if (userId && isAuthenticated && message.messageId && message.chatId) {
                                await this.handleMessageRead(userId, message.messageId, message.chatId);
                            }
                            break;
                            
                        case 'ping':
                            ws.send(JSON.stringify({ 
                                type: 'pong', 
                                timestamp: Date.now(),
                                userId,
                                isAuthenticated 
                            }));
                            break;
                            
                        case 'debug_info':
                            this.sendDebugInfo(ws, userId);
                            break;
                            
                        default:
                            console.warn(`⚠️ Неизвестный тип сообщения: ${message.type}`);
                    }
                } catch (error) {
                    console.error('❌ Ошибка обработки WS сообщения:', error);
                    this.sendError(ws, error.message);
                }
            });

            ws.on('close', (code, reason) => {
                console.log(`🔌 Закрыто соединение ${userId ? `для ${userId}` : 'anonymous'}`, {
                    code,
                    reason: reason.toString(),
                    authenticated: isAuthenticated
                });
                if (userId && isAuthenticated) {
                    this.handleDisconnect(userId, ws);
                }
                clearTimeout(authTimeout);
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket ошибка:', error);
                clearTimeout(authTimeout);
            });
        });
    }

    // ОБНОВЛЕННЫЙ МЕТОД АУТЕНТИФИКАЦИИ
    async handleAuthentication(ws, token) {
        try {
            console.log('🔐 Проверка токена...');
        
            let decoded;
            let isExpired = false;
        
            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET);
            } catch (error) {
                if (error.name === 'TokenExpiredError') {
                    console.log('⚠️ Токен истек, но декодируем для получения userId');
                    isExpired = true;
                    decoded = jwt.decode(token);
                
                    if (!decoded || !decoded.userId) {
                        throw new Error('Не удалось декодировать истекший токен');
                    }
                
                    ws.send(JSON.stringify({
                        type: 'token_expired',
                        message: 'Access token expired',
                        error: 'TokenExpiredError',
                        needsRefresh: true,
                        userId: decoded.userId,
                        timestamp: Date.now()
                    }));
                } else {
                    throw error;
                }
            }
        
            const userId = decoded.userId;
        
            if (!userId) {
                throw new Error('User ID not found in token');
            }
        
            const numericUserId = String(userId).replace(/\D/g, '');
        
            if (!numericUserId) {
                throw new Error('Invalid user ID format');
            }
        
            if (isExpired) {
                console.log(`⚠️ Пользователь ${numericUserId} с истекшим токеном`);
            
                if (!this.userConnections.has(numericUserId)) {
                    this.userConnections.set(numericUserId, new Set());
                }
                this.userConnections.get(numericUserId).add(ws);
            
                ws.userId = numericUserId;
                ws.isAuthenticated = false;
            
                return {
                    userId: numericUserId,
                    authenticated: false,
                    expired: true
                };
            }
        
            if (!this.userConnections.has(numericUserId)) {
                this.userConnections.set(numericUserId, new Set());
            }
            this.userConnections.get(numericUserId).add(ws);
        
            ws.userId = numericUserId;
            ws.isAuthenticated = true;
        
            console.log(`✅ Аутентифицирован пользователь: ${numericUserId}`);
        
            ws.send(JSON.stringify({
                type: 'authenticated',
                userId: numericUserId,
                timestamp: Date.now(),
                message: 'Аутентификация успешна'
            }));
        
            // 🔥 ОТПРАВЛЯЕМ ВСЕМ, ЧТО ПОЛЬЗОВАТЕЛЬ ОНЛАЙН
            this.broadcastUserStatus(numericUserId, 'online');
        
            return {
                userId: numericUserId,
                authenticated: true,
                expired: false
            };
        
        } catch (error) {
            console.error('❌ Ошибка аутентификации:', error.message);
        
            if (error.name === 'TokenExpiredError') {
                ws.send(JSON.stringify({
                    type: 'auth_error',
                    message: 'Токен истек',
                    error: error.name,
                    needsRefresh: true
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'auth_error',
                    message: error.message,
                    needsRefresh: false
                }));
                ws.close(1008, 'Authentication failed');
            }
        
            return {
                userId: null,
                authenticated: false,
                expired: false
            };
        }
    }

    // НОВЫЙ МЕТОД: ОБРАБОТКА ОБНОВЛЕНИЯ ТОКЕНА ЧЕРЕЗ WS
    async handleTokenRefresh(ws, refreshToken, clientIp = '0.0.0.0') {
        try {
            console.log('🔄 Обновление токена через WebSocket...');
            
            if (!refreshToken) {
                throw new Error('Refresh token не предоставлен');
            }
            
            // Используем SessionService для обновления токенов
            const result = await SessionService.refreshUserTokens(refreshToken, clientIp);
            
            console.log('✅ Токены обновлены через WS');
            
            // Отправляем новые токены клиенту
            ws.send(JSON.stringify({
                type: 'tokens_refreshed',
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                sessionToken: result.sessionToken,
                accessTokenExpiresIn: result.accessTokenExpiresIn,
                timestamp: Date.now(),
                message: 'Токены успешно обновлены'
            }));
            
            return result;
            
        } catch (error) {
            console.error('❌ Ошибка обновления токена через WS:', error);
            
            ws.send(JSON.stringify({
                type: 'refresh_error',
                error: error.message,
                code: error.code || 'REFRESH_FAILED',
                timestamp: Date.now(),
                message: 'Не удалось обновить токен'
            }));
            
            throw error;
        }
    }

    async loadUserChats(userId) {
        try {
            const result = await pool.query(
                `SELECT id FROM chats 
                 WHERE id LIKE $1 OR id LIKE $2 OR id LIKE $3`,
                [`%user_${userId}%`, `user_${userId}_%`, `%_user_${userId}`]
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
            const participants = this.extractParticipantIds(chatId);
            if (!participants.includes(userId)) {
                throw new Error(`User ${userId} has no access to chat ${chatId}`);
            }
            
            await this.ensureChatExists(chatId, userId);
            this.subscribeToChat(userId, chatId);
            
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
    try {
        console.log(`👋 Пользователь ${userId} покидает чат ${chatId}`);

        // Проверяем, имеет ли пользователь доступ к чату
        const participants = this.extractParticipantIds(chatId);
        if (!participants.includes(userId)) {
            console.log(`⚠️ Пользователь ${userId} пытается покинуть чат, к которому не имеет доступа`);
            return;
        }

        // Удаляем чат из подписок пользователя
        if (this.userChats.has(userId)) {
            this.userChats.get(userId).delete(chatId);
        }

        // Удаляем пользователя из подписчиков чата
        if (this.chatSubscriptions.has(chatId)) {
            this.chatSubscriptions.get(chatId).delete(userId);
        }

        // Отправляем подтверждение
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'left_chat',
                chatId: chatId,
                timestamp: Date.now()
            }));
        }

        console.log(`✅ Пользователь ${userId} покинул чат ${chatId}`);

    } catch (error) {
        console.error(`❌ Ошибка при выходе из чата ${chatId}:`, error);
        this.sendError(ws, error.message);
    }
}

    async handleSendMessage(userId, messageData) {
        try {
            const { chatId, text, type = 'text', senderName } = messageData;
            
            console.log(`📤 ${userId} отправляет сообщение в ${chatId}:`, {
                text: text.substring(0, 100),
                type
            });

            // 1. Проверяем доступ к чату
            const participants = this.extractParticipantIds(chatId);
            if (!participants.includes(userId)) {
                throw new Error(`User ${userId} has no access to chat ${chatId}`);
            }
            
            // 2. Обеспечиваем существование чата
            await this.ensureChatExists(chatId, userId);
            
            // 3. Обновляем таймстамп чата
            await this.updateChatTimestamp(chatId, text);
            
            // 4. Сохраняем сообщение в БД
            const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const result = await pool.query(
                `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [messageId, chatId, text, userId, senderName || 'User', Date.now(), type]
            );

            const savedMessage = result.rows[0];
            
            // 5. Подготавливаем данные для отправки
            const messageForClients = {
                type: 'new_message',
                chatId,
                message: savedMessage,
                timestamp: Date.now(),
                senderId: userId
            };
            
            // 6. Отправляем сообщение всем участникам чата
            this.broadcastToChat(chatId, messageForClients, userId);
            
            // 7. Отправляем подтверждение отправителю
            this.sendToUser(userId, {
                type: 'message_sent',
                messageId,
                chatId,
                status: 'delivered',
                timestamp: Date.now()
            });
            
            // 8. Уведомляем об обновлении списка чатов
            this.notifyChatListUpdate(chatId);
            
            console.log(`✅ Сообщение ${messageId} доставлено в чат ${chatId}`);
            
            // 9. Логируем статистику
            this.logMessageStats(chatId, userId);
            
        } catch (error) {
            console.error('❌ Ошибка отправки сообщения через WS:', error);
            this.sendToUser(userId, {
                type: 'message_error',
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    // Ключевой метод: извлечение ID участников из chatId
    extractParticipantIds(chatId) {
        try {
            // Формат: "user_123456_user_789012" или "123456_789012"
            console.log(`🔍 Извлекаем участников из chatId: ${chatId}`);
            
            // Удаляем префикс "user_" если есть
            const cleanChatId = chatId.replace(/user_/g, '');
            
            // Разделяем по "_"
            const parts = cleanChatId.split('_');
            
            if (parts.length < 2) {
                console.error(`❌ Неверный формат chatId: ${chatId}`);
                return [];
            }
            
            // Первые два числа - это ID участников
            const participant1 = parts[0];
            const participant2 = parts[1];
            
            console.log(`🔍 Участники (числовые ID): ${participant1}, ${participant2}`);
            return [participant1, participant2];
            
        } catch (error) {
            console.error(`❌ Ошибка извлечения участников из ${chatId}:`, error);
            return [];
        }
    }

    async updateChatTimestamp(chatId, lastMessage = null) {
        try {
            const chatCheck = await pool.query(
                'SELECT id FROM chats WHERE id = $1',
                [chatId]
            );
            
            if (chatCheck.rows.length === 0) {
                // Получаем участников и имя чата
                const participants = this.extractParticipantIds(chatId);
                const [userId1, userId2] = participants;
                
                // Находим отправителя и получателя
                const senderId = participants[0]; // упрощенно
                
                // Получаем имя другого пользователя для названия чата
                const otherUserId = participants.find(id => id !== senderId) || userId2;
                
                const userResult = await pool.query(
                    'SELECT display_name FROM users WHERE user_id = $1',
                    [otherUserId]
                );
                
                const chatName = userResult.rows.length > 0 
                    ? userResult.rows[0].display_name 
                    : `User ${otherUserId.slice(-4)}`;
                
                await pool.query(
                    `INSERT INTO chats (id, name, type, timestamp, last_message) 
                    VALUES ($1, $2, $3, $4, $5)`,
                    [chatId, chatName, 'private', Date.now(), lastMessage]
                );
                
                console.log(`✅ Чат создан: ${chatId} (${chatName})`);
            } else {
                await pool.query(
                    `UPDATE chats SET timestamp = $1, last_message = COALESCE($2, last_message) WHERE id = $3`,
                    [Date.now(), lastMessage, chatId]
                );
                
                console.log(`🔄 Чат обновлен: ${chatId}`);
            }
            
        } catch (error) {
            console.error(`❌ Ошибка обновления чата ${chatId}:`, error);
        }
    }

    async ensureChatExists(chatId, senderId) {
        try {
            const chatResult = await pool.query(
                'SELECT id FROM chats WHERE id = $1',
                [chatId]
            );
            
            if (chatResult.rows.length === 0) {
                const participants = this.extractParticipantIds(chatId);
                const otherUserId = participants.find(id => id !== senderId);
                
                if (!otherUserId) {
                    throw new Error(`Cannot find other user in chat: ${chatId}`);
                }
                
                const userResult = await pool.query(
                    'SELECT display_name FROM users WHERE user_id = $1',
                    [otherUserId]
                );
                
                const otherUserName = userResult.rows.length > 0 
                    ? userResult.rows[0].display_name 
                    : `User ${otherUserId.slice(-4)}`;
                
                await pool.query(
                    'INSERT INTO chats (id, name, type, timestamp) VALUES ($1, $2, $3, $4)',
                    [chatId, otherUserName, 'private', Date.now()]
                );
                
                console.log(`✅ Чат создан через WS: ${chatId} (${otherUserName})`);
                
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

    // Ключевой метод: рассылка сообщений в чат
    broadcastToChat(chatId, data, excludeUserId = null) {
        try {
            console.log(`🔥 Рассылка в чат ${chatId}`, {
                type: data.type,
                exclude: excludeUserId
            });
            
            // 1. Получаем числовые ID участников
            const participants = this.extractParticipantIds(chatId);
            
            if (participants.length === 0) {
                console.error(`❌ Не удалось определить участников чата ${chatId}`);
                return;
            }
            
            console.log(`🔥 Участники чата:`, participants);
            
            // 2. Отправляем каждому участнику
            let sentCount = 0;
            participants.forEach(userId => {
                // userId здесь уже числовой
                if (!excludeUserId || String(userId) !== String(excludeUserId)) {
                    const success = this.sendToUser(userId, data);
                    if (success) sentCount++;
                }
            });
            
            console.log(`📊 В чат ${chatId} отправлено ${sentCount} сообщений из ${participants.length} участников`);
            
        } catch (error) {
            console.error(`❌ Ошибка рассылки в чат ${chatId}:`, error);
        }
    }

    // Ключевой метод: отправка конкретному пользователю
    sendToUser(userId, data) {
        try {
            // Преобразуем userId в строку для надежности
            const userIdStr = String(userId);
            
            console.log(`📤 sendToUser:`, {
                userId: userIdStr,
                type: data.type,
                connections: this.userConnections.has(userIdStr) ? this.userConnections.get(userIdStr).size : 0
            });
            
            const userConnections = this.userConnections.get(userIdStr);
            
            if (!userConnections || userConnections.size === 0) {
                console.log(`⚠️ Пользователь ${userIdStr} не имеет активных WebSocket соединений`);
                return false;
            }
            
            let sentCount = 0;
            userConnections.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify(data));
                        sentCount++;
                        console.log(`✅ Сообщение отправлено пользователю ${userIdStr}`);
                    } catch (sendError) {
                        console.error(`❌ Ошибка отправки пользователю ${userIdStr}:`, sendError);
                    }
                } else {
                    console.log(`⚠️ WebSocket пользователя ${userIdStr} не в состоянии OPEN: ${ws.readyState}`);
                }
            });
            
            console.log(`📊 Пользователю ${userIdStr} отправлено ${sentCount} из ${userConnections.size} сообщений`);
            return sentCount > 0;
            
        } catch (error) {
            console.error(`❌ Критическая ошибка sendToUser для ${userId}:`, error);
            return false;
        }
    }

    notifyChatListUpdate(chatId) {
        try {
            const participants = this.extractParticipantIds(chatId);
            
            participants.forEach(userId => {
                this.sendToUser(userId, {
                    type: 'chat_updated',
                    chatId,
                    timestamp: Date.now()
                });
            });
            
        } catch (error) {
            console.error(`❌ Ошибка уведомления об обновлении чата ${chatId}:`, error);
        }
    }

    handleTyping(userId, chatId, isTyping) {
        const typingMessage = {
            type: 'user_typing',           
            chatId: chatId,
            userId: userId,
            isTyping: isTyping,            
            timestamp: Date.now()
        };
    
        console.log(`✏️ ${userId} ${isTyping ? 'печатает' : 'перестал печатать'} в ${chatId}`);
    
        this.broadcastToChat(chatId, typingMessage, userId);
    }

    async handleMessageRead(userId, messageId, chatId) {
        try {
            await pool.query(
                'UPDATE messages SET read = true WHERE id = $1 AND chat_id = $2',
                [messageId, chatId]
            );
            
            const messageResult = await pool.query(
                'SELECT sender_id FROM messages WHERE id = $1',
                [messageId]
            );
            
            if (messageResult.rows.length > 0) {
                const senderId = messageResult.rows[0].sender_id;
                
                if (String(senderId) !== String(userId)) {
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

    handleDisconnect(userId, ws) {
        if (this.userConnections.has(userId)) {
            this.userConnections.get(userId).delete(ws);
        
            if (this.userConnections.get(userId).size === 0) {
                this.userConnections.delete(userId);
                this.userChats.delete(userId);
            
                this.broadcastUserStatus(userId, 'offline', Date.now());
            }
        }
    
        console.log(`👋 Пользователь ${userId} отключился`);
    }

    cleanupDeadConnections() {
        let cleaned = 0;
        
        this.userConnections.forEach((connections, userId) => {
            const aliveConnections = new Set();
            
            connections.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    aliveConnections.add(ws);
                } else {
                    cleaned++;
                }
            });
            
            if (aliveConnections.size === 0) {
                this.userConnections.delete(userId);
                this.userChats.delete(userId);
            } else {
                this.userConnections.set(userId, aliveConnections);
            }
        });
        
        if (cleaned > 0) {
            console.log(`🧹 Очищено ${cleaned} мертвых соединений`);
        }
    }

    sendError(ws, message, code = 'WS_ERROR') {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message,
                    code,
                    timestamp: Date.now()
                }));
            }
        } catch (error) {
            console.error('❌ Ошибка отправки ошибки:', error);
        }
    }

    sendDebugInfo(ws, userId) {
        const info = {
            type: 'debug_info',
            userId,
            timestamp: Date.now(),
            stats: {
                totalUsers: this.userConnections.size,
                userConnections: Array.from(this.userConnections.entries()).map(([id, conns]) => ({
                    userId: id,
                    connectionCount: conns.size
                })),
                chatSubscriptions: Array.from(this.chatSubscriptions.entries()).map(([chatId, subs]) => ({
                    chatId,
                    subscriberCount: subs.size
                }))
            }
        };
    
        ws.send(JSON.stringify(info));
    }

    broadcastUserStatus(userId, status, lastSeen = null) {
        const statusMessage = {
            type: 'user_status',
            userId: userId,
            status: status,
            lastSeen: lastSeen || Date.now(),
            timestamp: Date.now()
        };

        console.log(`📢 Рассылка статуса ${status} для пользователя ${userId}`);

        // Отправляем всем пользователям, у которых есть чаты с этим userId
        this.userConnections.forEach((connections, uid) => {
            if (uid !== userId) {
                this.sendToUser(uid, statusMessage);
            }
        });
    } 

    logMessageStats(chatId, senderId) {
        const participants = this.extractParticipantIds(chatId);
    
        console.log(`📊 Статистика отправки сообщения:`, {
            chatId,
            senderId,
            participants,
            senderHasConnections: this.userConnections.has(senderId),
            receiverIds: participants.filter(id => id !== senderId),
            receiversConnected: participants
                .filter(id => id !== senderId)
                .map(id => ({
                    userId: id,
                    connected: this.userConnections.has(id) && this.userConnections.get(id).size > 0
                }))
        });
    }  

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
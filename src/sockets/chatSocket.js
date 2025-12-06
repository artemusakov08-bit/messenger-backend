const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class ChatSocket {
    constructor(wss) {
        this.wss = wss;
        this.userConnections = new Map(); // userId -> WebSocket[]
        this.chatSubscriptions = new Map(); // chatId -> Set(userId)
        this.setupConnection();
    }

    setupConnection() {
        this.wss.on('connection', (ws, request) => {
            console.log('🔌 Новое WebSocket подключение для чатов');
            
            let userId = null;
            
            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data);
                    
                    switch (message.type) {
                        case 'authenticate':
                            userId = await this.handleAuthentication(ws, message.token);
                            break;
                            
                        case 'join_chat':
                            if (userId) this.handleJoinChat(userId, message.chatId);
                            break;
                            
                        case 'leave_chat':
                            if (userId) this.handleLeaveChat(userId, message.chatId);
                            break;
                            
                        case 'send_message':
                            if (userId) await this.handleSendMessage(userId, message);
                            break;
                            
                        case 'ping':
                            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                            break;
                    }
                } catch (error) {
                    console.error('❌ Ошибка обработки сообщения:', error);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: error.message 
                    }));
                }
            });

            ws.on('close', () => {
                if (userId) {
                    this.handleDisconnect(userId, ws);
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
            
            if (!this.userConnections.has(userId)) {
                this.userConnections.set(userId, new Set());
            }
            this.userConnections.get(userId).add(ws);
            
            console.log(`✅ Пользователь авторизован: ${userId}`);
            
            ws.send(JSON.stringify({
                type: 'authenticated',
                userId,
                timestamp: Date.now()
            }));
            
            return userId;
            
        } catch (error) {
            console.error('❌ Ошибка авторизации:', error);
            ws.send(JSON.stringify({
                type: 'auth_error',
                message: 'Invalid token'
            }));
            ws.close();
            return null;
        }
    }

    handleJoinChat(userId, chatId) {
        if (!this.chatSubscriptions.has(chatId)) {
            this.chatSubscriptions.set(chatId, new Set());
        }
        this.chatSubscriptions.get(chatId).add(userId);
        
        console.log(`🔗 Пользователь ${userId} подписан на чат ${chatId}`);
        
        const wsSet = this.userConnections.get(userId);
        if (wsSet) {
            wsSet.forEach(ws => {
                ws.send(JSON.stringify({
                    type: 'joined_chat',
                    chatId,
                    timestamp: Date.now()
                }));
            });
        }
    }

    handleLeaveChat(userId, chatId) {
        if (this.chatSubscriptions.has(chatId)) {
            this.chatSubscriptions.get(chatId).delete(userId);
        }
        
        console.log(`🔗 Пользователь ${userId} отписан от чата ${chatId}`);
    }

    async handleSendMessage(userId, messageData) {
        const { chatId, text, type = 'text' } = messageData;
        
        console.log(`📤 ${userId} отправляет сообщение в ${chatId}: ${text}`);
        
        // Сохраняем в БД
        const pool = require('../config/database');
        const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const result = await pool.query(
            `INSERT INTO messages (id, chat_id, text, sender_id, sender_name, timestamp, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [messageId, chatId, text, userId, messageData.senderName || 'User', Date.now(), type]
        );

        const savedMessage = result.rows[0];
        
        // Отправляем сообщение всем подписанным на чат
        this.broadcastToChat(chatId, {
            type: 'new_message',
            chatId,
            message: savedMessage,
            timestamp: Date.now()
        });
        
        // Отправляем подтверждение отправителю
        const senderWs = this.userConnections.get(userId);
        if (senderWs) {
            senderWs.forEach(ws => {
                ws.send(JSON.stringify({
                    type: 'message_sent',
                    messageId,
                    chatId,
                    status: 'delivered',
                    timestamp: Date.now()
                }));
            });
        }
        
        console.log(`✅ Сообщение ${messageId} доставлено в чат ${chatId}`);
    }

    broadcastToChat(chatId, data) {
        if (!this.chatSubscriptions.has(chatId)) return;
        
        const subscribers = this.chatSubscriptions.get(chatId);
        
        subscribers.forEach(userId => {
            const userWs = this.userConnections.get(userId);
            if (userWs) {
                userWs.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(data));
                    }
                });
            }
        });
    }

    handleDisconnect(userId, ws) {
        if (this.userConnections.has(userId)) {
            this.userConnections.get(userId).delete(ws);
            if (this.userConnections.get(userId).size === 0) {
                this.userConnections.delete(userId);
            }
        }
        
        // Удаляем из всех подписок на чаты
        this.chatSubscriptions.forEach((subscribers, chatId) => {
            subscribers.delete(userId);
        });
        
        console.log(`👋 Пользователь ${userId} отключен от чатов`);
    }
}

module.exports = ChatSocket;
// src/middleware/syncMiddleware.js
const SyncService = require('../services/SyncService');

class SyncMiddleware {
    constructor(io) {
        this.syncService = new SyncService(io);
    }

    // 🔄 Обработка нового сообщения с синхронизацией
    async handleMessageWithSync(req, res, next) {
        try {
            const { userId, deviceId } = req.user;
            const { chatId, text, type } = req.body;
            
            // Сохраняем оригинальные методы res
            const originalJson = res.json.bind(res);
            const originalStatus = res.status.bind(res);
            
            // Переопределяем res.json для отправки синхронизации
            res.json = (data) => {
                // Отправляем синхронизацию на другие устройства
                this.syncService.syncMessage(userId, {
                    chatId: chatId,
                    message: data,
                    senderDeviceId: deviceId
                });
                
                // Возвращаем оригинальный ответ
                originalJson(data);
            };
            
            next();
        } catch (error) {
            console.error('❌ Ошибка middleware синхронизации:', error);
            next();
        }
    }

    // 👁️ Обработка прочтения сообщения с синхронизацией
    async handleMessageReadWithSync(req, res, next) {
        try {
            const { userId, deviceId } = req.user;
            const { messageId, chatId } = req.body;
            
            const originalJson = res.json.bind(res);
            
            res.json = (data) => {
                this.syncService.syncMessageRead(userId, {
                    chatId: chatId,
                    messageId: messageId,
                    readerDeviceId: deviceId
                });
                
                originalJson(data);
            };
            
            next();
        } catch (error) {
            console.error('❌ Ошибка middleware синхронизации прочтения:', error);
            next();
        }
    }

    // ✏️ Обработка редактирования сообщения с синхронизацией
    async handleMessageEditWithSync(req, res, next) {
        try {
            const { userId, deviceId } = req.user;
            const { messageId, chatId, newText } = req.body;
            
            const originalJson = res.json.bind(res);
            
            res.json = (data) => {
                this.syncService.syncMessageEdit(userId, {
                    chatId: chatId,
                    messageId: messageId,
                    newText: newText,
                    editorDeviceId: deviceId
                });
                
                originalJson(data);
            };
            
            next();
        } catch (error) {
            console.error('❌ Ошибка middleware синхронизации редактирования:', error);
            next();
        }
    }

    // 🗑️ Обработка удаления сообщения с синхронизацией
    async handleMessageDeleteWithSync(req, res, next) {
        try {
            const { userId, deviceId } = req.user;
            const { messageId } = req.params;
            const { chatId } = req.body;
            
            const originalJson = res.json.bind(res);
            
            res.json = (data) => {
                this.syncService.syncMessageDelete(userId, {
                    chatId: chatId,
                    messageId: messageId,
                    deleterDeviceId: deviceId
                });
                
                originalJson(data);
            };
            
            next();
        } catch (error) {
            console.error('❌ Ошибка middleware синхронизации удаления:', error);
            next();
        }
    }

    // 📱 Middleware для регистрации устройства
    registerDeviceMiddleware() {
        return (req, res, next) => {
            try {
                const { userId, deviceId } = req.user;
                const socketId = req.headers['x-socket-id'];
                
                if (socketId && this.syncService.notificationService) {
                    this.syncService.notificationService.registerDevice(userId, deviceId, socketId);
                }
                
                next();
            } catch (error) {
                console.error('❌ Ошибка регистрации устройства:', error);
                next();
            }
        };
    }

    // 🔄 Middleware для уведомления о новом входе
    notifyNewLoginMiddleware() {
        return async (req, res, next) => {
            try {
                const { userId, deviceId, deviceName } = req.user;
                
                // Вызываем после успешного ответа
                const originalJson = res.json.bind(res);
                
                res.json = async (data) => {
                    if (data.success && data.session) {
                        await this.syncService.notifyNewDeviceLogin(userId, {
                            id: data.session.id,
                            deviceId: deviceId,
                            deviceName: deviceName || 'Unknown Device',
                            os: req.user.deviceInfo?.os || 'Unknown',
                            location: data.session.location,
                            ipAddress: req.ip,
                            createdAt: data.session.createdAt
                        });
                    }
                    
                    originalJson(data);
                };
                
                next();
            } catch (error) {
                console.error('❌ Ошибка уведомления о новом входе:', error);
                next();
            }
        };
    }

    // 🚪 Middleware для уведомления о выходе
    notifyLogoutMiddleware() {
        return async (req, res, next) => {
            try {
                const { userId, deviceId, deviceName } = req.user;
                const sessionId = req.user.sessionId;
                
                const originalJson = res.json.bind(res);
                
                res.json = async (data) => {
                    if (data.success) {
                        await this.syncService.notifySessionTermination(userId, {
                            sessionId: sessionId,
                            deviceId: deviceId,
                            deviceName: deviceName
                        }, 'USER_LOGOUT');
                    }
                    
                    originalJson(data);
                };
                
                next();
            } catch (error) {
                console.error('❌ Ошибка уведомления о выходе:', error);
                next();
            }
        };
    }
}

module.exports = SyncMiddleware;
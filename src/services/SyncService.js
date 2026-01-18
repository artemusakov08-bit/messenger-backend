const NotificationService = require('./NotificationService');

class SyncService {
    constructor(io) {
        this.io = io;
        this.notificationService = new NotificationService(io);
        this.userStates = new Map();
        this.messageQueues = new Map(); 
        this.initialize();
    }

    initialize() {
        console.log('🔄 SyncService инициализирован');
        setInterval(() => this.cleanupQueues(), 30000);
    }

    // 📱 Уведомление о новом входе
    async notifyNewDeviceLogin(userId, newSession) {
        try {
            console.log(`🔔 Новый вход: ${userId} на ${newSession.deviceName}`);
            
            this.notificationService.sendNewLoginNotification(userId, {
                id: newSession.id,
                deviceId: newSession.deviceId,
                deviceName: newSession.deviceName,
                os: newSession.os,
                location: newSession.location,
                ipAddress: newSession.ipAddress,
                createdAt: newSession.createdAt
            });

            this.io.to(`user:${userId}:sessions`).except(`user:${userId}:device:${newSession.deviceId}`).emit('session:new', {
                type: 'SESSION_NEW',
                sessionId: newSession.id,
                deviceId: newSession.deviceId,
                deviceName: newSession.deviceName,
                location: newSession.location,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Ошибка уведомления о новом входе:', error);
        }
    }

    // 🚪 Уведомление о завершении сессии
    async notifySessionTermination(userId, sessionData, reason = 'MANUAL') {
        try {
            console.log(`🔔 Завершение сессии ${sessionData.sessionId} для ${userId}`);
            
            this.notificationService.sendSessionTerminatedNotification(userId, {
                id: sessionData.sessionId,
                deviceId: sessionData.deviceId,
                deviceName: sessionData.deviceName
            }, reason);

            this.io.to(`user:${userId}:device:${sessionData.deviceId}`).emit('session:terminated', {
                type: 'SESSION_TERMINATED',
                sessionId: sessionData.sessionId,
                reason: reason,
                timestamp: new Date().toISOString()
            });

            this.io.to(`user:${userId}:sessions`).except(`user:${userId}:device:${sessionData.deviceId}`).emit('session:removed', {
                type: 'SESSION_REMOVED',
                sessionId: sessionData.sessionId,
                deviceId: sessionData.deviceId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Ошибка уведомления о завершении сессии:', error);
        }
    }

    // 📨 Синхронизация сообщений
    async syncMessage(userId, messageData) {
        try {
            const { chatId, message, senderDeviceId } = messageData;
            console.log(`🔄 Синхронизация сообщения ${message.id} для ${userId}`);
            
            const onlineDevices = this.notificationService.getOnlineDevices(userId);
            const devicesToSync = onlineDevices.filter(d => d !== senderDeviceId);
            
            if (devicesToSync.length === 0) return;
            
            devicesToSync.forEach(deviceId => {
                this.io.to(`user:${userId}:device:${deviceId}`).emit('message:sync', {
                    type: 'MESSAGE_SYNC',
                    chatId: chatId,
                    message: message,
                    syncType: 'NEW_MESSAGE',
                    timestamp: new Date().toISOString()
                });
            });
            
            this.io.to(`user:${userId}`).emit('message:status_update', {
                type: 'MESSAGE_STATUS_UPDATE',
                messageId: message.id,
                chatId: chatId,
                status: 'DELIVERED',
                deliveredTo: devicesToSync,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации сообщения:', error);
        }
    }

    // ✅ Синхронизация статуса прочтения
    async syncMessageRead(userId, readData) {
        try {
            const { chatId, messageId, readerDeviceId } = readData;
            console.log(`👁️ Синхронизация прочтения ${messageId} для ${userId}`);
            
            const onlineDevices = this.notificationService.getOnlineDevices(userId);
            const devicesToSync = onlineDevices.filter(d => d !== readerDeviceId);
            
            devicesToSync.forEach(deviceId => {
                this.io.to(`user:${userId}:device:${deviceId}`).emit('message:read_sync', {
                    type: 'MESSAGE_READ_SYNC',
                    messageId: messageId,
                    chatId: chatId,
                    readBy: readerDeviceId,
                    timestamp: new Date().toISOString()
                });
            });
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации прочтения:', error);
        }
    }

    // 💬 Синхронизация статуса "печатает"
    async syncTyping(userId, typingData) {
        try {
            const { chatId, isTyping, deviceId } = typingData;
            
            this.io.to(`user:${userId}:sessions`).except(`user:${userId}:device:${deviceId}`).emit('typing:sync', {
                type: 'TYPING_SYNC',
                chatId: chatId,
                userId: userId,
                isTyping: isTyping,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации печатания:', error);
        }
    }

    // 📱 Синхронизация статуса онлайн
    async syncOnlineStatus(userId, deviceId, isOnline) {
        try {
            this.io.to(`user:${userId}:sessions`).except(`user:${userId}:device:${deviceId}`).emit('presence:update', {
                type: 'PRESENCE_UPDATE',
                userId: userId,
                deviceId: deviceId,
                status: isOnline ? 'online' : 'offline',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации статуса:', error);
        }
    }

    // 🔄 Синхронизация редактирования сообщения
    async syncMessageEdit(userId, editData) {
        try {
            const { chatId, messageId, newText, editorDeviceId } = editData;
            console.log(`✏️ Синхронизация редактирования ${messageId} для ${userId}`);
            
            const onlineDevices = this.notificationService.getOnlineDevices(userId);
            const devicesToSync = onlineDevices.filter(d => d !== editorDeviceId);
            
            devicesToSync.forEach(deviceId => {
                this.io.to(`user:${userId}:device:${deviceId}`).emit('message:edit_sync', {
                    type: 'MESSAGE_EDIT_SYNC',
                    messageId: messageId,
                    chatId: chatId,
                    newText: newText,
                    timestamp: new Date().toISOString()
                });
            });
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации редактирования:', error);
        }
    }

    // 🗑️ Синхронизация удаления сообщения
    async syncMessageDelete(userId, deleteData) {
        try {
            const { chatId, messageId, deleterDeviceId } = deleteData;
            console.log(`🗑️ Синхронизация удаления ${messageId} для ${userId}`);
            
            const onlineDevices = this.notificationService.getOnlineDevices(userId);
            const devicesToSync = onlineDevices.filter(d => d !== deleterDeviceId);
            
            devicesToSync.forEach(deviceId => {
                this.io.to(`user:${userId}:device:${deviceId}`).emit('message:delete_sync', {
                    type: 'MESSAGE_DELETE_SYNC',
                    messageId: messageId,
                    chatId: chatId,
                    timestamp: new Date().toISOString()
                });
            });
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации удаления:', error);
        }
    }

    // ⏰ Синхронизация пропущенных сообщений при восстановлении
    async syncMissedMessages(userId, deviceId, missedMessages) {
        try {
            console.log(`📦 Синхронизация ${missedMessages.length} пропущенных сообщений для ${userId}`);
            
            this.io.to(`user:${userId}:device:${deviceId}`).emit('sync:missed', {
                type: 'SYNC_MISSED',
                messages: missedMessages,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации пропущенных сообщений:', error);
        }
    }

    // 📍 Обновить местоположение устройства
    async updateDeviceLocation(userId, deviceId, location) {
        try {
            this.io.to(`user:${userId}:sessions`).except(`user:${userId}:device:${deviceId}`).emit('device:location_update', {
                type: 'DEVICE_LOCATION_UPDATE',
                deviceId: deviceId,
                location: location,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Ошибка обновления локации:', error);
        }
    }

    // 🔒 Уведомление о смене пароля/2FA
    async notifySecurityChange(userId, changeType) {
        try {
            console.log(`🔒 Уведомление о изменении безопасности ${changeType} для ${userId}`);
            
            this.io.to(`user:${userId}`).emit('security:change', {
                type: 'SECURITY_CHANGE',
                changeType: changeType,
                timestamp: new Date().toISOString(),
                requiresReauth: true
            });
            
        } catch (error) {
            console.error('❌ Ошибка уведомления об изменении безопасности:', error);
        }
    }

    // 🧹 Очистка очередей
    cleanupQueues() {
        const now = Date.now();
        let cleaned = 0;
        
        this.messageQueues.forEach((deviceMap, userId) => {
            deviceMap.forEach((queue, deviceId) => {
                const newQueue = queue.filter(msg => now - msg.timestamp < 300000);
                if (newQueue.length !== queue.length) {
                    cleaned += (queue.length - newQueue.length);
                    deviceMap.set(deviceId, newQueue);
                }
            });
        });
        
        if (cleaned > 0) {
            console.log(`🧹 Очищено ${cleaned} старых сообщений из очередей`);
        }
    }

    // 📊 Получить статистику синхронизации
    getStats() {
        return {
            totalUsers: this.userStates.size,
            messageQueues: Array.from(this.messageQueues.entries()).map(([userId, deviceMap]) => ({
                userId,
                devices: Array.from(deviceMap.entries()).map(([deviceId, queue]) => ({
                    deviceId,
                    queueSize: queue.length
                }))
            }))
        };
    }
}

module.exports = SyncService;
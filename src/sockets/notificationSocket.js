const { Server } = require('socket.io');

class NotificationSocket {
  constructor(io) {
    this.io = io;
    this.setupHandlers();
  }

  setupHandlers() {
    this.io.on('connection', (socket) => {
      console.log('🔔 Notification socket connected:', socket.id);

      // Подписка на уведомления пользователя
      socket.on('subscribe:user', (data) => {
        const { userId, deviceId } = data;
        if (userId && deviceId) {
          const room = `user:${userId}:device:${deviceId}`;
          socket.join(room);
          console.log(`✅ Устройство ${deviceId} подписано на уведомления пользователя ${userId}`);
        }
      });

      // Подписка на сессионные уведомления
      socket.on('subscribe:sessions', (data) => {
        const { userId } = data;
        if (userId) {
          const room = `user:${userId}:sessions`;
          socket.join(room);
          console.log(`✅ Подписка на сессии пользователя ${userId}`);
        }
      });

      // Отписка от уведомлений
      socket.on('unsubscribe:user', (data) => {
        const { userId, deviceId } = data;
        if (userId && deviceId) {
          const room = `user:${userId}:device:${deviceId}`;
          socket.leave(room);
          console.log(`❌ Устройство ${deviceId} отписано от уведомлений пользователя ${userId}`);
        }
      });

      // Проверка активности
      socket.on('ping:session', (data) => {
        const { sessionId, userId } = data;
        socket.emit('pong:session', { 
          sessionId, 
          timestamp: new Date().toISOString(),
          serverTime: Date.now()
        });
      });

      socket.on('disconnect', () => {
        console.log('🔔 Notification socket disconnected:', socket.id);
      });
    });
  }

  // Отправка уведомления о новой сессии
  notifyNewLogin(userId, newSessionData) {
    this.io.to(`user:${userId}:sessions`).emit('session:new_login', {
      type: 'NEW_LOGIN',
      data: newSessionData,
      timestamp: new Date().toISOString()
    });
  }

  // Отправка уведомления о завершении сессии
  notifySessionTerminated(userId, sessionData) {
    this.io.to(`user:${userId}:sessions`).emit('session:terminated', {
      type: 'SESSION_TERMINATED',
      data: sessionData,
      timestamp: new Date().toISOString()
    });
  }

  // Отправка уведомления на конкретное устройство
  notifyDevice(userId, deviceId, notification) {
    const room = `user:${userId}:device:${deviceId}`;
    this.io.to(room).emit('device:notification', notification);
  }

  // Отправка уведомления всем устройствам пользователя
  notifyAllDevices(userId, notification) {
    const room = `user:${userId}:sessions`;
    this.io.to(room).emit('user:notification', notification);
  }

  // Проверка онлайн статуса устройства
  isDeviceOnline(userId, deviceId) {
    const room = `user:${userId}:device:${deviceId}`;
    const sockets = this.io.sockets.adapter.rooms.get(room);
    return sockets && sockets.size > 0;
  }
}

// Синглтон
let notificationSocketInstance = null;

function initializeNotificationSocket(io) {
  if (!notificationSocketInstance) {
    notificationSocketInstance = new NotificationSocket(io);
  }
  return notificationSocketInstance;
}

function getNotificationSocket() {
  if (!notificationSocketInstance) {
    throw new Error('Notification socket not initialized');
  }
  return notificationSocketInstance;
}

module.exports = {
  initializeNotificationSocket,
  getNotificationSocket
};
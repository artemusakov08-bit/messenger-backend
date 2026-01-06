const WebSocket = require('ws');

class NotificationService {
  constructor(io) {
    this.io = io;
    this.connectedDevices = new Map(); // userId -> Set(deviceIds)
  }

  // 📱 Регистрация устройства для уведомлений
  registerDevice(userId, deviceId, socketId) {
    if (!this.connectedDevices.has(userId)) {
      this.connectedDevices.set(userId, new Set());
    }
    this.connectedDevices.get(userId).add(deviceId);
    
    // Присоединяем сокет к комнатам
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(`user:${userId}`);
      socket.join(`user:${userId}:device:${deviceId}`);
      socket.join(`user:${userId}:sessions`);
    }
    
    console.log(`📱 Устройство ${deviceId} зарегистрировано для уведомлений пользователя ${userId}`);
  }

  // 🔔 Отправить уведомление о новом входе
  sendNewLoginNotification(userId, newSession) {
    const notification = {
      type: 'SESSION_NEW_LOGIN',
      title: 'Новый вход в аккаунт',
      message: `В ваш аккаунт вошли с устройства: ${newSession.deviceName}`,
      data: {
        sessionId: newSession.id,
        deviceName: newSession.deviceName,
        os: newSession.os,
        location: newSession.location,
        ipAddress: newSession.ipAddress,
        timestamp: newSession.createdAt
      },
      priority: 'high',
      timestamp: new Date().toISOString()
    };

    // Отправляем всем устройствам пользователя кроме нового
    this.io.to(`user:${userId}`).except(`user:${userId}:device:${newSession.deviceId}`).emit('notification', notification);
    
    console.log(`🔔 Уведомление о новом входе отправлено пользователю ${userId}`);
  }

  // 🚪 Отправить уведомление о завершении сессии
  sendSessionTerminatedNotification(userId, session, reason = 'MANUAL') {
    const notification = {
      type: 'SESSION_TERMINATED',
      title: 'Сессия завершена',
      message: 'Ваша сессия на этом устройстве была завершена',
      data: {
        sessionId: session.id,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        reason: reason,
        terminatedAt: new Date().toISOString()
      },
      priority: 'medium',
      timestamp: new Date().toISOString()
    };

    // Отправляем на конкретное устройство
    this.io.to(`user:${userId}:device:${session.deviceId}`).emit('notification', notification);
    
    console.log(`🔔 Уведомление о завершении сессии отправлено на устройство ${session.deviceId}`);
  }

  // 🔒 Отправить уведомление о безопасности
  sendSecurityNotification(userId, title, message, data = {}) {
    const notification = {
      type: 'SECURITY_ALERT',
      title: title,
      message: message,
      data: data,
      priority: 'high',
      timestamp: new Date().toISOString()
    };

    this.io.to(`user:${userId}`).emit('notification', notification);
  }

  // 📊 Отправить уведомление всем устройствам пользователя
  broadcastToUser(userId, notification) {
    this.io.to(`user:${userId}`).emit('notification', {
      ...notification,
      timestamp: new Date().toISOString()
    });
  }

  // 🔍 Проверить онлайн статус устройства
  isDeviceOnline(userId, deviceId) {
    const room = `user:${userId}:device:${deviceId}`;
    const sockets = this.io.sockets.adapter.rooms.get(room);
    return sockets && sockets.size > 0;
  }

  // 📋 Получить онлайн устройства пользователя
  getOnlineDevices(userId) {
    const devices = [];
    const userRooms = Array.from(this.io.sockets.adapter.rooms.keys())
      .filter(room => room.startsWith(`user:${userId}:device:`));
    
    userRooms.forEach(room => {
      const deviceId = room.split(':')[3];
      if (deviceId && this.isDeviceOnline(userId, deviceId)) {
        devices.push(deviceId);
      }
    });
    
    return devices;
  }

  // 🗑️ Удалить устройство при отключении
  unregisterDevice(userId, deviceId, socketId) {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.leave(`user:${userId}`);
      socket.leave(`user:${userId}:device:${deviceId}`);
      socket.leave(`user:${userId}:sessions`);
    }
    
    if (this.connectedDevices.has(userId)) {
      this.connectedDevices.get(userId).delete(deviceId);
      if (this.connectedDevices.get(userId).size === 0) {
        this.connectedDevices.delete(userId);
      }
    }
    
    console.log(`📱 Устройство ${deviceId} удалено из уведомлений пользователя ${userId}`);
  }
}

module.exports = NotificationService;
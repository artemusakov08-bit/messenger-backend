const Session = require('../models/Session');
const jwtUtils = require('../utils/jwtUtils');
const axios = require('axios');
const { getNotificationSocket } = require('../sockets/notificationSocket');

class SessionService {
  constructor() {
    this.ACCESS_TOKEN_TTL = 3600;
    this.REFRESH_TOKEN_TTL = 30 * 24 * 3600;
    this.MAX_SESSIONS_PER_USER = 10;
    this.notificationSocket = null;
  }

  // Получаем экземпляр сокета
  getSocket() {
    if (!this.notificationSocket) {
      this.notificationSocket = getNotificationSocket();
    }
    return this.notificationSocket;
  }

  // 🆕 Создать полную сессию с токенами
  async createUserSession(userData, deviceData, ipAddress = null) {
  const { userId, phone, username, displayName } = userData;
  const { deviceId, deviceName, os, deviceInfo = {} } = deviceData;
  
  console.log(`🆕 Создание сессии для пользователя ${userId}, устройства ${deviceId}`);
  
  // 🔥 ДЕАКТИВИРУЕМ СТАРУЮ СЕССИЮ ДЛЯ ЭТОГО УСТРОЙСТВА
  const Session = require('../models/Session');
  await Session.deactivateAllForDevice(userId, deviceId);
  
  // Проверяем лимит сессий
  await this.enforceSessionLimit(userId);
  
  // Получаем локацию
  const location = await this.getLocationFromIP(ipAddress);
  
  // Генерируем токены
  const tokens = jwtUtils.generateTokenPair(userId, deviceId, deviceName);
  
  // Определяем детали устройства
  const finalDeviceName = deviceName || this.detectDeviceName(deviceInfo);
  const finalOs = os || this.detectOS(deviceInfo);
  
  // Создаем сессию
  const session = await Session.create({
    userId,
    deviceId,
    deviceName: finalDeviceName,
    os: finalOs,
    deviceInfo: {
      ...deviceInfo,
      userAgent: deviceInfo.userAgent || 'Unknown',
      screenResolution: deviceInfo.screenResolution || 'Unknown',
      language: deviceInfo.language || 'en',
      timezone: deviceInfo.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      trustedIps: [ipAddress].filter(Boolean),
      appVersion: deviceInfo.appVersion || '1.0.0',
      platform: deviceInfo.platform || 'android'
    },
    sessionToken: tokens.sessionToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    ipAddress,
    location
  });
  
  // Отправляем уведомление о новом входе на другие устройства
  this.getSocket().notifyNewLogin(userId, {
    sessionId: session.session_id,
    deviceId,
    deviceName: finalDeviceName,
    deviceInfo: {
      os: finalOs,
      platform: deviceInfo.platform || 'android'
    },
    location: {
      city: location?.city || location?.country || 'Unknown',
      country: location?.country || 'Unknown',
      isLocal: location?.isLocal || false
    },
    ip: ipAddress ? this.maskIP(ipAddress) : 'Unknown',
    timestamp: new Date().toISOString()
  });
  
  // Обновляем статус пользователя
  await this.updateUserStatus(userId, 'online');
  
  return {
    session: {
      id: session.session_id,
      deviceId: session.device_id,
      deviceName: session.device_name,
      os: session.os,
      createdAt: session.created_at,
      location: session.location,
      ipAddress: session.ip_address ? this.maskIP(session.ip_address) : null
    },
    tokens: {
      sessionToken: tokens.sessionToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: session.access_token_expires_at,
      refreshTokenExpiresAt: session.refresh_token_expires_at
    },
    user: {
      id: userId,
      phone,
      username,
      displayName,
      status: 'online'
    }
  };
}

  // 🔄 Обновить токены с валидацией
  async refreshUserTokens(refreshToken, ipAddress = null) {
    const tokenResult = jwtUtils.verifyRefreshToken(refreshToken);
    
    if (!tokenResult.valid) {
      throw {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Неверный refresh token',
        reason: tokenResult.error
      };
    }
    
    const { userId, deviceId, sessionId } = tokenResult.decoded;
    
    const session = await Session.findByRefreshToken(refreshToken);
    
    if (!session) {
      throw {
        code: 'SESSION_NOT_FOUND',
        message: 'Сессия не найдена'
      };
    }
    
    if (!session.is_active) {
      throw {
        code: 'SESSION_INACTIVE',
        message: 'Сессия неактивна'
      };
    }
    
    if (!jwtUtils.verifySessionToken(session.session_token, sessionId)) {
      throw {
        code: 'SESSION_MISMATCH',
        message: 'Несоответствие сессии'
      };
    }
    
    if (session.device_id !== deviceId) {
      throw {
        code: 'DEVICE_MISMATCH',
        message: 'Несоответствие устройства'
      };
    }
    
    const now = new Date();
    const refreshExpiresAt = new Date(session.refresh_token_expires_at);
    
    if (now > refreshExpiresAt) {
      await Session.deactivate(session.session_id, userId);
      
      // Уведомляем устройство об истечении
      this.getSocket().notifyDevice(userId, deviceId, {
        type: 'SESSION_EXPIRED',
        reason: 'REFRESH_TOKEN_EXPIRED',
        timestamp: now.toISOString()
      });
      
      throw {
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'Refresh token истек'
      };
    }
    
    const tokens = jwtUtils.generateTokenPair(userId, deviceId, session.device_name);
    
    const updatedSession = await Session.updateTokens(
      session.session_id,
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionToken: tokens.sessionToken
      },
      ipAddress
    );
    
    if (!updatedSession) {
      throw {
        code: 'SESSION_UPDATE_FAILED',
        message: 'Не удалось обновить сессию'
      };
    }
    
    console.log(`✅ Токены обновлены для устройства ${deviceId}`);
    
    // Отправляем новые токены на устройство через WebSocket
    this.getSocket().notifyDevice(userId, deviceId, {
      type: 'TOKENS_UPDATED',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      timestamp: new Date().toISOString()
    });
    
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionToken: tokens.sessionToken,
      accessTokenExpiresAt: updatedSession.access_token_expires_at,
      refreshTokenExpiresAt: updatedSession.refresh_token_expires_at,
      sessionId: updatedSession.session_id
    };
  }

  // 📋 Получить активные сессии пользователя
  async getUserSessions(userId, currentDeviceId = null) {
    const sessions = await Session.findByUserId(userId, currentDeviceId);
    
    return sessions.map(session => ({
      id: session.session_id,
      deviceId: session.device_id,
      deviceName: session.device_name,
      deviceInfo: session.device_info ? JSON.parse(session.device_info) : {},
      ipAddress: session.ip_address ? this.maskIP(session.ip_address) : null,
      location: session.location ? JSON.parse(session.location) : null,
      os: session.os,
      createdAt: session.created_at,
      lastActiveAt: session.last_active_at,
      isCurrent: currentDeviceId ? session.device_id === currentDeviceId : false,
      isActive: session.is_active,
      accessTokenExpiresAt: session.access_token_expires_at,
      refreshTokenExpiresAt: session.refresh_token_expires_at,
      sessionAge: this.calculateSessionAge(session.created_at),
      isOnline: this.getSocket().isDeviceOnline(userId, session.device_id)
    }));
  }

  // 🚪 Завершить сессию
  async terminateSession(sessionId, userId, currentDeviceId = null) {
    const session = await Session.findById(sessionId);
    
    if (!session) {
      throw { code: 'SESSION_NOT_FOUND', message: 'Сессия не найдена' };
    }
    
    if (session.user_id !== userId) {
      throw { code: 'UNAUTHORIZED', message: 'Недостаточно прав' };
    }
    
    if (currentDeviceId && session.device_id === currentDeviceId) {
      throw { 
        code: 'CURRENT_SESSION', 
        message: 'Для завершения текущей сессии используйте logout' 
      };
    }
    
    const terminated = await Session.deactivate(sessionId, userId);
    
    if (!terminated) {
      throw { code: 'TERMINATION_FAILED', message: 'Не удалось завершить сессию' };
    }
    
    // Уведомляем устройство о завершении сессии
    this.getSocket().notifyDevice(userId, session.device_id, {
      type: 'SESSION_TERMINATED',
      reason: 'MANUAL_TERMINATION',
      timestamp: new Date().toISOString(),
      terminatedBy: currentDeviceId,
      sessionId
    });
    
    // Если это была последняя активная сессия, обновляем статус пользователя
    const activeSessions = await Session.findByUserId(userId);
    if (activeSessions.length === 0) {
      await this.updateUserStatus(userId, 'offline');
    }
    
    return terminated;
  }

  // 🚫 Завершить все сессии кроме текущей
  async terminateAllOtherSessions(userId, currentDeviceId) {
    const sessions = await Session.findByUserId(userId);
    let terminatedCount = 0;
    
    for (const session of sessions) {
      if (session.device_id !== currentDeviceId && session.is_active) {
        await Session.deactivate(session.session_id, userId);
        terminatedCount++;
        
        // Уведомляем каждое устройство
        this.getSocket().notifyDevice(userId, session.device_id, {
          type: 'SESSION_TERMINATED',
          reason: 'MANUAL_TERMINATION_ALL',
          timestamp: new Date().toISOString(),
          terminatedBy: currentDeviceId,
          sessionId: session.session_id
        });
      }
    }
    
    return terminatedCount;
  }

  // 🚪 Выход из текущей сессии
  async logout(userId, deviceId, sessionId) {
    const session = await Session.findByDevice(userId, deviceId);
    
    if (!session) {
      throw { code: 'SESSION_NOT_FOUND', message: 'Сессия не найдена' };
    }
    
    const terminated = await Session.deactivate(session.session_id, userId);
    
    if (terminated) {
      // Обновляем статус пользователя если нет других активных сессий
      const activeSessions = await Session.findByUserId(userId);
      if (activeSessions.length === 0) {
        await this.updateUserStatus(userId, 'offline');
      }
      
      // Уведомляем об выходе
      this.getSocket().notifyDevice(userId, deviceId, {
        type: 'LOGOUT',
        reason: 'USER_INITIATED',
        timestamp: new Date().toISOString(),
        sessionId
      });
    }
    
    return terminated;
  }

  // 🔍 Валидация access token
  async validateAccessToken(accessToken, ipAddress = null) {
    const tokenResult = jwtUtils.verifyAccessToken(accessToken);
    
    if (!tokenResult.valid) {
      return { 
        valid: false, 
        code: tokenResult.error === 'TokenExpiredError' ? 'ACCESS_TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: tokenResult.message
      };
    }
    
    const { userId, deviceId, sessionId } = tokenResult.decoded;
    
    const session = await Session.findByAccessToken(accessToken);
    
    if (!session) {
      return { valid: false, code: 'SESSION_NOT_FOUND', message: 'Сессия не найдена' };
    }
    
    if (!session.is_active) {
      return { valid: false, code: 'SESSION_INACTIVE', message: 'Сессия неактивна' };
    }
    
    if (!jwtUtils.verifySessionToken(session.session_token, sessionId)) {
      return { valid: false, code: 'SESSION_MISMATCH', message: 'Несоответствие сессии' };
    }
    
    if (session.device_id !== deviceId) {
      return { valid: false, code: 'DEVICE_MISMATCH', message: 'Несоответствие устройства' };
    }
    
    const now = new Date();
    const tokenExpiresAt = new Date(session.access_token_expires_at);
    
    if (now > tokenExpiresAt) {
      return { 
        valid: false, 
        code: 'ACCESS_TOKEN_EXPIRED', 
        message: 'Access token истек',
        canRefresh: true 
      };
    }
    
    // Обновляем время активности
    await Session.updateActivity(session.session_id, ipAddress);
    
    // Периодически проверяем и обновляем сессию
    if (this.shouldRefreshSession(session)) {
      await this.refreshSessionIfNeeded(session);
    }
    
    // Проверяем онлайн статус устройства
    const isOnline = this.getSocket().isDeviceOnline(userId, deviceId);
    if (!isOnline && session.is_active) {
      // Помечаем как неактивную если устройство оффлайн долгое время
      await this.markInactiveIfOfflineTooLong(session);
    }
    
    return { 
      valid: true, 
      userId: session.user_id,
      deviceId: session.device_id,
      deviceName: session.device_name,
      sessionId: session.session_id,
      session: session,
      isOnline
    };
  }

  // 🧹 Обеспечение лимита сессий
  async enforceSessionLimit(userId) {
    const sessions = await Session.findByUserId(userId);
    
    if (sessions.length >= this.MAX_SESSIONS_PER_USER) {
      const oldestSession = sessions[sessions.length - 1];
      await Session.deactivate(oldestSession.session_id, userId);
      
      // Уведомляем пользователя
      this.getSocket().notifyDevice(userId, oldestSession.device_id, {
        type: 'SESSION_REMOVED',
        reason: 'SESSION_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString(),
        maxSessions: this.MAX_SESSIONS_PER_USER,
        sessionId: oldestSession.session_id
      });
      
      console.log(`⚠️ Удалена старая сессия ${oldestSession.device_id} из-за лимита`);
    }
  }

  // 📍 Получение локации по IP
  async getLocationFromIP(ipAddress) {
    if (!ipAddress || this.isPrivateIP(ipAddress)) {
      return {
        type: 'private',
        city: 'Local Network',
        country: 'Local',
        isp: 'Local Network',
        isLocal: true
      };
    }
    
    try {
      const response = await axios.get(`http://ip-api.com/json/${ipAddress}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`, {
        timeout: 3000
      });
      
      if (response.data?.status === 'success') {
        return {
          ip: response.data.query,
          city: response.data.city,
          region: response.data.regionName,
          country: response.data.country,
          countryCode: response.data.countryCode,
          lat: response.data.lat,
          lon: response.data.lon,
          timezone: response.data.timezone,
          isp: response.data.isp,
          asn: response.data.as,
          type: 'external',
          isLocal: false
        };
      }
    } catch (error) {
      console.warn('⚠️ Не удалось получить локацию по IP:', error.message);
    }
    
    return null;
  }

  // 📱 Определить название устройства
  detectDeviceName(deviceInfo) {
    if (deviceInfo.model) return deviceInfo.model;
    if (deviceInfo.brand && deviceInfo.device) {
      return `${deviceInfo.brand} ${deviceInfo.device}`;
    }
    if (deviceInfo.userAgent) {
      if (deviceInfo.userAgent.includes('Android')) return 'Android Device';
      if (deviceInfo.userAgent.includes('iPhone')) return 'iPhone';
      if (deviceInfo.userAgent.includes('iPad')) return 'iPad';
      if (deviceInfo.userAgent.includes('Windows')) return 'Windows PC';
      if (deviceInfo.userAgent.includes('Mac')) return 'Mac';
      if (deviceInfo.userAgent.includes('Linux')) return 'Linux Device';
    }
    return 'Unknown Device';
  }

  // 🖥️ Определить ОС
  detectOS(deviceInfo) {
    if (deviceInfo.os) return deviceInfo.os;
    if (deviceInfo.userAgent) {
      if (deviceInfo.userAgent.includes('Android')) return 'Android';
      if (deviceInfo.userAgent.includes('iPhone') || deviceInfo.userAgent.includes('iPad')) return 'iOS';
      if (deviceInfo.userAgent.includes('Windows')) return 'Windows';
      if (deviceInfo.userAgent.includes('Mac')) return 'macOS';
      if (deviceInfo.userAgent.includes('Linux')) return 'Linux';
    }
    return 'Unknown';
  }

  // 🛡️ Проверка приватного IP
  isPrivateIP(ip) {
    return ip === '127.0.0.1' || 
           ip === '::1' ||
           ip.startsWith('192.168.') ||
           ip.startsWith('10.') ||
           ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./);
  }

  // 🎭 Маскировка IP для безопасности
  maskIP(ip) {
    if (!ip) return null;
    if (this.isPrivateIP(ip)) return ip;
    
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
    return ip;
  }

  // 📅 Расчет возраста сессии
  calculateSessionAge(createdAt) {
    const created = new Date(createdAt);
    const now = new Date();
    const diffMs = now - created;
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}д ${hours}ч`;
    if (hours > 0) return `${hours}ч ${minutes}м`;
    return `${minutes}м`;
  }

  // 🔄 Проверка необходимости обновления сессии
  shouldRefreshSession(session) {
    const now = new Date();
    const lastActive = new Date(session.last_active_at);
    const hoursSinceLastActive = (now - lastActive) / (1000 * 60 * 60);
    
    // Обновляем если прошло больше 12 часов
    return hoursSinceLastActive > 12;
  }

  // 🔄 Обновление сессии если нужно
  async refreshSessionIfNeeded(session) {
    try {
      const tokens = jwtUtils.generateTokenPair(
        session.user_id,
        session.device_id,
        session.device_name
      );
      
      await Session.updateTokens(
        session.session_id,
        {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          sessionToken: tokens.sessionToken
        },
        null
      );
      
      // Отправляем новые токены на устройство
      this.getSocket().notifyDevice(session.user_id, session.device_id, {
        type: 'TOKENS_UPDATED',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Ошибка обновления сессии:', error);
    }
  }

  // 👤 Обновление статуса пользователя
  async updateUserStatus(userId, status) {
      const db = require('../config/database');
      const client = await db.getClient();
      try {
          await client.query(
              'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
              [status, Date.now(), userId]
          );
          
          // Получаем всех пользователей, у которых есть чаты с этим userId
          const chatsResult = await client.query(
              `SELECT DISTINCT user_id FROM (
                  SELECT 
                      CASE 
                          WHEN split_part(chat_id, '_', 2) = $1 THEN split_part(chat_id, '_', 4)
                          ELSE split_part(chat_id, '_', 2)
                      END as user_id
                  FROM messages 
                  WHERE chat_id LIKE $2 OR chat_id LIKE $3 OR chat_id LIKE $4
                  UNION
                  SELECT 
                      CASE 
                          WHEN position($5 in chat_id) = 1 THEN split_part(chat_id, '_', 4)
                          ELSE split_part(chat_id, '_', 2)
                      END
                  FROM chats 
                  WHERE id LIKE $2 OR id LIKE $3 OR id LIKE $4
              ) AS participants WHERE user_id IS NOT NULL AND user_id != $1`,
              [userId, `%${userId}%`, `${userId}_%`, `%_${userId}`, `user_${userId}_`]
          );
          
          // Отправляем статус всем участникам чатов
          const notificationSocket = require('../sockets/notificationSocket').getNotificationSocket();
          
          chatsResult.rows.forEach(row => {
              notificationSocket.sendToUser(row.user_id, {
                  type: 'user_status',
                  userId: userId,
                  status: status,
                  lastSeen: Date.now(),
                  timestamp: new Date().toISOString()
              });
          });
          
          // Также уведомляем все устройства самого пользователя
          notificationSocket.notifyAllDevices(userId, {
              type: 'USER_STATUS_CHANGE',
              userId,
              status,
              timestamp: new Date().toISOString()
          });
          
          console.log(`📢 Статус пользователя ${userId} изменен на ${status}, уведомлено ${chatsResult.rows.length} пользователей`);
          
      } finally {
          client.release();
      }
  }

  // 🚫 Пометить сессию неактивной если устройство долго оффлайн
  async markInactiveIfOfflineTooLong(session) {
    const now = new Date();
    const lastActive = new Date(session.last_active_at);
    const hoursSinceLastActive = (now - lastActive) / (1000 * 60 * 60);
    
    // Если устройство оффлайн более 24 часов, помечаем как неактивное
    if (hoursSinceLastActive > 24 && session.is_active) {
      await Session.deactivate(session.session_id, session.user_id);
      console.log(`⚠️ Сессия ${session.device_id} помечена неактивной из-за долгого отсутствия`);
    }
  }

  // 🧹 Очистка устаревших сессий
  async cleanupExpiredSessions() {
    const db = require('../config/database');
    const client = await db.getClient();
    try {
      const result = await client.query(
        `UPDATE sessions SET is_active = false 
         WHERE refresh_token_expires_at < NOW() 
         AND is_active = true 
         RETURNING session_id, user_id, device_id`
      );
      
      const expiredSessions = result.rows;
      
      // Уведомляем о завершении сессий
      for (const session of expiredSessions) {
        this.getSocket().notifyDevice(session.user_id, session.device_id, {
          type: 'SESSION_EXPIRED',
          reason: 'AUTO_EXPIRATION',
          timestamp: new Date().toISOString(),
          sessionId: session.session_id
        });
      }
      
      if (expiredSessions.length > 0) {
        console.log(`🧹 Очищено ${expiredSessions.length} устаревших сессий`);
      }
      
      return expiredSessions.length;
    } finally {
      client.release();
    }
  }

  // 📊 Получить статистику сессий
  async getSessionStats() {
    const db = require('../config/database');
    const client = await db.getClient();
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total_sessions,
          SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_sessions,
          SUM(CASE WHEN NOT is_active THEN 1 ELSE 0 END) as inactive_sessions,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT device_id) as unique_devices,
          AVG(EXTRACT(EPOCH FROM (last_active_at - created_at))) as avg_session_duration
        FROM sessions
      `);
      
      return result.rows[0];
    } finally {
      client.release();
    }
  }
}

module.exports = new SessionService();
const Session = require('../models/Session');
const tokenService = require('./tokenService');
const { Op } = require('sequelize');
const axios = require('axios');
const redis = require('redis');
const WebSocket = require('ws');

class SessionService {
  constructor() {
    // Подключение Redis для кэширования сессий
    this.redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    this.redisClient.connect().then(() => {
      console.log('✅ Redis connected for session caching');
    }).catch(console.error);
    
    // Настройки
    this.ACCESS_TOKEN_TTL = 3600; // 1 час в секундах
    this.REFRESH_TOKEN_TTL = 30 * 24 * 3600; // 30 дней в секундах
    this.SESSION_CACHE_TTL = 300; // 5 минут кэширования сессий в Redis
  }

  // 🆕 Создание новой сессии
  async createSession(userId, deviceData, ipAddress = null) {
    const { deviceId, deviceName, os, deviceInfo = {}, fcmToken } = deviceData;
    
    // Проверяем, не превышен ли лимит сессий (макс 10 устройств)
    const activeSessions = await this.getUserSessions(userId);
    if (activeSessions.length >= 10) {
      // Удаляем самую старую сессию
      const oldestSession = activeSessions.sort((a, b) => 
        new Date(a.lastActiveAt) - new Date(b.lastActiveAt)
      )[0];
      await this.terminateSession(oldestSession.id, userId);
    }
    
    // Генерируем токены
    const tokens = tokenService.generateTokenPair(userId, deviceId, deviceName);
    
    // Получаем локацию по IP
    const location = await this.getLocationFromIP(ipAddress);
    
    // Создаем сессию
    const session = await Session.create({
      userId,
      deviceId,
      deviceName: deviceName || this.detectDeviceName(deviceInfo),
      os: os || this.detectOS(deviceInfo),
      deviceInfo: {
        ...deviceInfo,
        fcmToken,
        screenResolution: deviceInfo.screenResolution,
        language: deviceInfo.language,
        timezone: deviceInfo.timezone,
        appVersion: deviceInfo.appVersion
      },
      sessionToken: tokens.sessionToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + this.ACCESS_TOKEN_TTL * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000),
      ipAddress,
      location,
      isActive: true
    });
    
    // Кэшируем сессию в Redis
    await this.cacheSession(session);
    
    // Отправляем уведомления о новом входе на другие устройства
    await this.notifyNewLogin(userId, session, activeSessions);
    
    return { session, tokens };
  }

  // 🔄 Обновление токенов
  async refreshTokens(refreshToken, ipAddress = null) {
    // Проверяем refresh token
    const tokenResult = tokenService.verifyRefreshToken(refreshToken);
    if (!tokenResult.valid) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }
    
    const { userId, deviceId } = tokenResult.decoded;
    
    // Ищем сессию по refresh token
    const session = await Session.findByRefreshToken(refreshToken);
    
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    
    if (!session.isActive) {
      throw new Error('SESSION_INACTIVE');
    }
    
    if (session.isRefreshTokenExpired()) {
      await session.deactivate();
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }
    
    // Проверяем устройство
    if (session.deviceId !== deviceId) {
      throw new Error('DEVICE_MISMATCH');
    }
    
    // Генерируем новые токены
    const tokens = tokenService.generateTokenPair(userId, deviceId, session.deviceName);
    
    // Обновляем сессию
    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken;
    session.accessTokenExpiresAt = new Date(Date.now() + this.ACCESS_TOKEN_TTL * 1000);
    session.refreshTokenExpiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);
    session.lastActiveAt = new Date();
    if (ipAddress) {
      session.ipAddress = ipAddress;
      session.location = await this.getLocationFromIP(ipAddress);
    }
    
    await session.save();
    
    // Обновляем кэш
    await this.cacheSession(session);
    
    return { session, tokens };
  }

  // 📋 Получить все сессии пользователя
  async getUserSessions(userId, currentDeviceId = null) {
    // Пробуем получить из кэша
    const cacheKey = `sessions:${userId}`;
    try {
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Redis cache read failed:', error);
    }
    
    // Получаем из базы
    const sessions = await Session.findAll({
      where: {
        userId,
        isActive: true,
        refreshTokenExpiresAt: {
          [Op.gt]: new Date()
        }
      },
      order: [['lastActiveAt', 'DESC']]
    });
    
    const formattedSessions = sessions.map(session => ({
      id: session.id,
      sessionId: session.id,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      os: session.os,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
      location: session.location,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      expiresAt: session.refreshTokenExpiresAt,
      isCurrent: currentDeviceId ? session.deviceId === currentDeviceId : false,
      isActive: session.isActive
    }));
    
    // Кэшируем
    try {
      await this.redisClient.setEx(cacheKey, this.SESSION_CACHE_TTL, JSON.stringify(formattedSessions));
    } catch (error) {
      console.warn('Redis cache write failed:', error);
    }
    
    return formattedSessions;
  }

  // 🚪 Завершить конкретную сессию
  async terminateSession(sessionId, userId) {
    const session = await Session.findOne({
      where: {
        id: sessionId,
        userId
      }
    });
    
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    
    await session.deactivate();
    
    // Инвалидируем кэш
    await this.invalidateSessionCache(userId);
    
    // Отправляем уведомление о выходе на это устройство (если оно онлайн)
    await this.notifySessionTerminated(session);
    
    return session;
  }

  // 🚫 Завершить все сессии кроме текущей
  async terminateAllOtherSessions(userId, currentDeviceId) {
    const result = await Session.update(
      { isActive: false },
      {
        where: {
          userId,
          deviceId: { [Op.ne]: currentDeviceId },
          isActive: true
        }
      }
    );
    
    // Инвалидируем кэш
    await this.invalidateSessionCache(userId);
    
    // Уведомляем все завершенные сессии
    const terminatedSessions = await Session.findAll({
      where: {
        userId,
        deviceId: { [Op.ne]: currentDeviceId },
        isActive: false
      }
    });
    
    for (const session of terminatedSessions) {
      await this.notifySessionTerminated(session);
    }
    
    return result[0];
  }

  // 🔍 Валидация access token
  async validateAccessToken(accessToken, ipAddress = null) {
    // Проверяем подпись токена
    const tokenResult = tokenService.verifyAccessToken(accessToken);
    if (!tokenResult.valid) {
      return { 
        valid: false, 
        reason: tokenResult.error === 'TokenExpiredError' ? 'ACCESS_TOKEN_EXPIRED' : 'INVALID_TOKEN',
        sessionId: tokenResult.decoded?.sessionId 
      };
    }
    
    const { userId, deviceId, sessionId } = tokenResult.decoded;
    
    // Ищем сессию в кэше
    const cacheKey = `session:${sessionId}`;
    let session;
    
    try {
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        session = JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Redis cache read failed:', error);
    }
    
    // Если нет в кэше, ищем в базе
    if (!session) {
      session = await Session.findOne({
        where: {
          userId,
          deviceId,
          isActive: true
        }
      });
      
      if (session) {
        // Кэшируем на 5 минут
        try {
          await this.redisClient.setEx(
            cacheKey, 
            this.SESSION_CACHE_TTL, 
            JSON.stringify(session.toJSON())
          );
        } catch (error) {
          console.warn('Redis cache write failed:', error);
        }
      }
    }
    
    if (!session) {
      return { valid: false, reason: 'SESSION_NOT_FOUND' };
    }
    
    // Проверяем соответствие access token
    if (session.accessToken !== accessToken) {
      return { valid: false, reason: 'TOKEN_MISMATCH' };
    }
    
    // Проверяем срок действия
    if (session.isAccessTokenExpired()) {
      return { valid: false, reason: 'ACCESS_TOKEN_EXPIRED' };
    }
    
    // Обновляем активность
    session.lastActiveAt = new Date();
    if (ipAddress && ipAddress !== session.ipAddress) {
      session.ipAddress = ipAddress;
      session.location = await this.getLocationFromIP(ipAddress);
    }
    
    await session.save();
    
    return { 
      valid: true, 
      userId: session.userId,
      deviceId: session.deviceId,
      sessionId: session.id,
      session: session
    };
  }

  // 📍 Определение локации по IP (используем ipinfo.io)
  async getLocationFromIP(ipAddress) {
    if (!ipAddress || ipAddress === '127.0.0.1' || ipAddress.startsWith('192.168.') || ipAddress.startsWith('10.')) {
      return {
        type: 'local',
        city: 'Local Network',
        country: 'Local'
      };
    }
    
    try {
      // Используем ipinfo.io (бесплатно 50k запросов в месяц)
      const response = await axios.get(`https://ipinfo.io/${ipAddress}/json?token=${process.env.IPINFO_TOKEN}`);
      
      if (response.data && !response.data.error) {
        const loc = response.data.loc ? response.data.loc.split(',') : [null, null];
        
        return {
          ip: response.data.ip,
          city: response.data.city,
          region: response.data.region,
          country: response.data.country,
          countryCode: response.data.country,
          lat: loc[0],
          lon: loc[1],
          timezone: response.data.timezone,
          isp: response.data.org,
          asn: response.data.asn,
          type: 'external'
        };
      }
    } catch (error) {
      console.warn('Failed to get location from IP:', error.message);
    }
    
    // Резервный вариант - использовать ip-api.com
    try {
      const response = await axios.get(`http://ip-api.com/json/${ipAddress}`);
      
      if (response.data && response.data.status === 'success') {
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
          type: 'external'
        };
      }
    } catch (error) {
      console.warn('Failed to get location from ip-api:', error.message);
    }
    
    return null;
  }

  // 🔔 Уведомление о новом входе
  async notifyNewLogin(userId, newSession, existingSessions) {
    if (!existingSessions || existingSessions.length === 0) return;
    
    const notificationData = {
      type: 'NEW_LOGIN',
      sessionId: newSession.id,
      deviceName: newSession.deviceName,
      os: newSession.os,
      location: newSession.location,
      ipAddress: newSession.ipAddress,
      timestamp: new Date().toISOString()
    };
    
    // Отправляем через WebSocket на все активные сессии
    const io = require('../sockets/notificationSocket').getIO();
    
    existingSessions.forEach(existingSession => {
      if (existingSession.deviceId !== newSession.deviceId) {
        io.to(`user:${userId}:device:${existingSession.deviceId}`).emit('session:new_login', notificationData);
        
        // Также отправляем push-уведомление если есть FCM токен
        if (existingSession.deviceInfo?.fcmToken) {
          this.sendPushNotification(
            existingSession.deviceInfo.fcmToken,
            'Новый вход в аккаунт',
            `В ваш аккаунт вошли с устройства ${newSession.deviceName} (${newSession.location?.city || 'Неизвестное местоположение'})`,
            notificationData
          );
        }
      }
    });
  }

  // 🔔 Уведомление о завершении сессии
  async notifySessionTerminated(session) {
    const io = require('../sockets/notificationSocket').getIO();
    
    io.to(`user:${session.userId}:device:${session.deviceId}`).emit('session:terminated', {
      type: 'SESSION_TERMINATED',
      sessionId: session.id,
      reason: 'MANUAL_TERMINATION',
      timestamp: new Date().toISOString()
    });
    
    // Отправляем push-уведомление
    if (session.deviceInfo?.fcmToken) {
      this.sendPushNotification(
        session.deviceInfo.fcmToken,
        'Сессия завершена',
        'Ваша сессия на этом устройстве была завершена',
        { type: 'SESSION_TERMINATED', sessionId: session.id }
      );
    }
  }

  // 📱 Отправка push-уведомления через FCM
  async sendPushNotification(fcmToken, title, body, data = {}) {
    try {
      const admin = require('firebase-admin');
      
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FCM_PROJECT_ID,
            clientEmail: process.env.FCM_CLIENT_EMAIL,
            privateKey: process.env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n')
          })
        });
      }
      
      const message = {
        token: fcmToken,
        notification: { title, body },
        data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'security_alerts'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };
      
      await admin.messaging().send(message);
    } catch (error) {
      console.error('FCM push notification error:', error);
    }
  }

  // 💾 Кэширование сессии в Redis
  async cacheSession(session) {
    try {
      const sessionData = session.toJSON ? session.toJSON() : session;
      
      // Кэшируем по sessionId
      await this.redisClient.setEx(
        `session:${session.id}`,
        this.SESSION_CACHE_TTL,
        JSON.stringify(sessionData)
      );
      
      // Кэшируем по access token (короткое время)
      await this.redisClient.setEx(
        `access_token:${session.accessToken}`,
        300, // 5 минут
        JSON.stringify({ userId: session.userId, deviceId: session.deviceId, sessionId: session.id })
      );
      
      // Обновляем список сессий пользователя
      await this.invalidateSessionCache(session.userId);
    } catch (error) {
      console.warn('Session cache failed:', error);
    }
  }

  // 🗑️ Инвалидация кэша сессий пользователя
  async invalidateSessionCache(userId) {
    try {
      await this.redisClient.del(`sessions:${userId}`);
    } catch (error) {
      console.warn('Cache invalidation failed:', error);
    }
  }

  // 📱 Определение названия устройства
  detectDeviceName(deviceInfo) {
    if (deviceInfo.model) {
      return deviceInfo.model;
    }
    if (deviceInfo.brand && deviceInfo.device) {
      return `${deviceInfo.brand} ${deviceInfo.device}`;
    }
    if (deviceInfo.userAgent) {
      if (deviceInfo.userAgent.includes('Android')) return 'Android Device';
      if (deviceInfo.userAgent.includes('iPhone')) return 'iPhone';
      if (deviceInfo.userAgent.includes('iPad')) return 'iPad';
    }
    return 'Unknown Device';
  }

  // 🖥️ Определение операционной системы
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

  // 🔍 Поиск сессии по токену
  async findSessionByToken(token, tokenType = 'access') {
    let session;
    
    switch (tokenType) {
      case 'access':
        session = await Session.findByAccessToken(token);
        break;
      case 'refresh':
        session = await Session.findByRefreshToken(token);
        break;
      case 'session':
        session = await Session.findBySessionToken(token);
        break;
      default:
        throw new Error('INVALID_TOKEN_TYPE');
    }
    
    return session;
  }

  // 🧹 Очистка истекших сессий (запускать по cron)
  async cleanupExpiredSessions() {
    const expiredCount = await Session.cleanExpiredSessions();
    
    // Также чистим кэш Redis
    try {
      const keys = await this.redisClient.keys('session:*');
      for (const key of keys) {
        const sessionStr = await this.redisClient.get(key);
        if (sessionStr) {
          const session = JSON.parse(sessionStr);
          if (new Date(session.refreshTokenExpiresAt) < new Date()) {
            await this.redisClient.del(key);
          }
        }
      }
    } catch (error) {
      console.warn('Redis cleanup failed:', error);
    }
    
    return expiredCount;
  }
}

module.exports = new SessionService();
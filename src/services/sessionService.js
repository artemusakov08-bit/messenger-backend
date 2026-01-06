const Session = require('../models/Session');
const jwtUtils = require('../utils/jwtUtils');
const axios = require('axios');
const db = require('../config/database');

class SessionService {
  constructor() {
    this.ACCESS_TOKEN_TTL = 3600;
    this.REFRESH_TOKEN_TTL = 30 * 24 * 3600;
    this.MAX_SESSIONS_PER_USER = 10;
  }

  // 🆕 Создать сессию
  async createSession(userId, deviceData, ipAddress = null) {
    const { deviceId, deviceName, os, deviceInfo = {} } = deviceData;
    
    // Проверяем лимит сессий
    const activeSessions = await this.getUserSessions(userId);
    if (activeSessions.length >= this.MAX_SESSIONS_PER_USER) {
      const oldestSession = activeSessions[activeSessions.length - 1];
      await Session.deactivate(oldestSession.session_id, userId);
    }
    
    // Генерируем токены
    const tokens = jwtUtils.generateTokenPair(userId, deviceId, deviceName);
    
    // Получаем локацию
    const location = await this.getLocationFromIP(ipAddress);
    
    // Создаем сессию
    const session = await Session.create({
      userId,
      deviceId,
      deviceName: deviceName || this.detectDeviceName(deviceInfo),
      os: os || this.detectOS(deviceInfo),
      deviceInfo,
      sessionToken: tokens.sessionToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      ipAddress,
      location
    });
    
    return { session, tokens };
  }

  // 🔄 Обновить токены
  async refreshTokens(refreshToken, ipAddress = null) {
    // Проверяем refresh token
    const tokenResult = jwtUtils.verifyRefreshToken(refreshToken);
    if (!tokenResult.valid) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }
    
    const { userId, deviceId } = tokenResult.decoded;
    
    // Ищем сессию
    const session = await Session.findByRefreshToken(refreshToken);
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    
    if (!session.is_active) {
      throw new Error('SESSION_INACTIVE');
    }
    
    if (Session.isRefreshTokenExpired(session)) {
      await Session.deactivate(session.session_id, userId);
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }
    
    if (session.device_id !== deviceId) {
      throw new Error('DEVICE_MISMATCH');
    }
    
    // Генерируем новые токены
    const tokens = jwtUtils.generateTokenPair(userId, deviceId, session.device_name);
    
    // Обновляем сессию
    const updatedSession = await Session.updateTokens(
      session.session_id,
      tokens,
      ipAddress
    );
    
    if (!updatedSession) {
      throw new Error('SESSION_UPDATE_FAILED');
    }
    
    return { session: updatedSession, tokens };
  }

  // 📋 Получить сессии пользователя
  async getUserSessions(userId, currentDeviceId = null) {
    return await Session.findByUserId(userId, currentDeviceId);
  }

  // 🚪 Завершить сессию
  async terminateSession(sessionId, userId) {
    const session = await Session.deactivate(sessionId, userId);
    
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    
    return session;
  }

  // 🚫 Завершить все сессии кроме текущей
  async terminateAllOtherSessions(userId, currentDeviceId) {
    return await Session.deactivateAllExcept(userId, currentDeviceId);
  }

  // 🔍 Валидация access token
  async validateAccessToken(accessToken, ipAddress = null) {
    // Проверяем подпись
    const tokenResult = jwtUtils.verifyToken(accessToken);
    if (!tokenResult.valid) {
      return { 
        valid: false, 
        reason: tokenResult.error === 'Токен истек' ? 'ACCESS_TOKEN_EXPIRED' : 'INVALID_TOKEN'
      };
    }
    
    const { userId, deviceId } = tokenResult.decoded;
    
    // Ищем сессию
    const session = await Session.findByAccessToken(accessToken);
    if (!session) {
      return { valid: false, reason: 'SESSION_NOT_FOUND' };
    }
    
    if (session.access_token !== accessToken) {
      return { valid: false, reason: 'TOKEN_MISMATCH' };
    }
    
    if (!session.is_active) {
      return { valid: false, reason: 'SESSION_INACTIVE' };
    }
    
    if (Session.isAccessTokenExpired(session)) {
      return { valid: false, reason: 'ACCESS_TOKEN_EXPIRED' };
    }
    
    // Обновляем активность
    await Session.updateActivity(session.session_id, ipAddress);
    
    return { 
      valid: true, 
      userId: session.user_id,
      deviceId: session.device_id,
      sessionId: session.session_id,
      session: session
    };
  }

  // 📍 Получить локацию по IP
  async getLocationFromIP(ipAddress) {
    if (!ipAddress || ipAddress === '127.0.0.1' || 
        ipAddress.startsWith('192.168.') || 
        ipAddress.startsWith('10.')) {
      return {
        type: 'local',
        city: 'Local Network',
        country: 'Local'
      };
    }
    
    try {
      const response = await axios.get(`http://ip-api.com/json/${ipAddress}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
      
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
      console.warn('Failed to get location from IP:', error.message);
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

  // 🧹 Очистить истекшие сессии
  async cleanupExpiredSessions() {
    return await Session.cleanupExpired();
  }

  // 📊 Получить статистику
  async getStats(userId = null) {
    return await Session.getStats(userId);
  }
}

module.exports = new SessionService();
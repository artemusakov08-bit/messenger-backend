const db = require('../config/database');
const crypto = require('crypto');

class Session {
  // 🆕 Создать сессию
  static async create(sessionData) {
    const {
      userId,
      deviceId,
      deviceName = 'Unknown Device',
      os = 'Unknown',
      deviceInfo = {},
      sessionToken,
      accessToken,
      refreshToken,
      ipAddress = null,
      location = null
    } = sessionData;

    const client = await db.getClient();
    try {
      const sessionId = 'sess_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');
      
      const now = new Date();
      const accessTokenExpiresAt = new Date(now.getTime() + 3600 * 1000);
      const refreshTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      
      const result = await client.query(
        `INSERT INTO sessions (
          session_id, user_id, device_id, device_name, os, device_info, 
          session_token, access_token, refresh_token, 
          access_token_expires_at, refresh_token_expires_at,
          ip_address, location, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
        RETURNING *`,
        [
          sessionId, userId, deviceId, deviceName, os, JSON.stringify(deviceInfo),
          sessionToken, accessToken, refreshToken,
          accessTokenExpiresAt, refreshTokenExpiresAt,
          ipAddress, JSON.stringify(location), now
        ]
      );
      
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // 🔍 Найти сессию по ID
  static async findById(sessionId) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        'SELECT * FROM sessions WHERE session_id = $1',
        [sessionId]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 🔍 Найти по access token
  static async findByAccessToken(accessToken) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        'SELECT * FROM sessions WHERE access_token = $1 AND is_active = true',
        [accessToken]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 🔄 Найти по refresh token
  static async findByRefreshToken(refreshToken) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        'SELECT * FROM sessions WHERE refresh_token = $1 AND is_active = true',
        [refreshToken]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 🔍 Найти по session token
  static async findBySessionToken(sessionToken) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        'SELECT * FROM sessions WHERE session_token = $1 AND is_active = true',
        [sessionToken]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 📋 Получить все сессии пользователя
  static async findByUserId(userId, currentDeviceId = null) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM sessions 
         WHERE user_id = $1 AND is_active = true 
         AND refresh_token_expires_at > NOW()
         ORDER BY last_active_at DESC`,
        [userId]
      );
      
      return result.rows.map(session => ({
        ...session,
        isCurrent: currentDeviceId ? session.device_id === currentDeviceId : false,
        location: session.location ? JSON.parse(session.location) : null,
        device_info: session.device_info ? JSON.parse(session.device_info) : {}
      }));
    } finally {
      client.release();
    }
  }

  // 🔍 Найти сессию по устройству
  static async findByDevice(userId, deviceId) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        'SELECT * FROM sessions WHERE user_id = $1 AND device_id = $2 AND is_active = true',
        [userId, deviceId]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 🔄 Обновить токены
  static async updateTokens(sessionId, newTokens, ipAddress = null) {
    const client = await db.getClient();
    try {
      const now = new Date();
      const accessTokenExpiresAt = new Date(now.getTime() + 3600 * 1000);
      const refreshTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      
      const result = await client.query(
        `UPDATE sessions SET 
          access_token = $1,
          refresh_token = $2,
          access_token_expires_at = $3,
          refresh_token_expires_at = $4,
          last_active_at = $5,
          ip_address = COALESCE($6, ip_address)
         WHERE session_id = $7 AND is_active = true
         RETURNING *`,
        [
          newTokens.accessToken,
          newTokens.refreshToken,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          now,
          ipAddress,
          sessionId
        ]
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 🔄 Обновить активность
  static async updateActivity(sessionId, ipAddress = null) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        `UPDATE sessions SET 
          last_active_at = NOW(),
          ip_address = COALESCE($2, ip_address)
         WHERE session_id = $1 AND is_active = true
         RETURNING *`,
        [sessionId, ipAddress]
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 🚪 Деактивировать сессию
  static async deactivate(sessionId, userId = null) {
    const client = await db.getClient();
    try {
      let query = 'UPDATE sessions SET is_active = false WHERE session_id = $1';
      const params = [sessionId];
      
      if (userId) {
        query += ' AND user_id = $2';
        params.push(userId);
      }
      
      query += ' RETURNING *';
      
      const result = await client.query(query, params);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // 🚫 Деактивировать все сессии кроме указанной
  static async deactivateAllExcept(userId, exceptDeviceId) {
    const client = await db.getClient();
    try {
      const result = await client.query(
        `UPDATE sessions SET is_active = false 
         WHERE user_id = $1 AND device_id != $2 AND is_active = true
         RETURNING COUNT(*) as count`,
        [userId, exceptDeviceId]
      );
      
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  // 🔍 Проверить истек ли access token
  static isAccessTokenExpired(session) {
    if (!session || !session.access_token_expires_at) return true;
    return new Date() > new Date(session.access_token_expires_at);
  }

  // 🔍 Проверить истек ли refresh token
  static isRefreshTokenExpired(session) {
    if (!session || !session.refresh_token_expires_at) return true;
    return new Date() > new Date(session.refresh_token_expires_at);
  }

  // 🔍 Проверить валидность сессии
  static isValid(session) {
    return session && 
           session.is_active && 
           !this.isRefreshTokenExpired(session);
  }

  // 🧹 Очистить истекшие сессии
  static async cleanupExpired() {
    const client = await db.getClient();
    try {
      const result = await client.query(
        `UPDATE sessions SET is_active = false 
         WHERE refresh_token_expires_at < NOW() AND is_active = true
         RETURNING COUNT(*) as count`
      );
      
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  // 📊 Получить статистику сессий
  static async getStats(userId = null) {
    const client = await db.getClient();
    try {
      let query = `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active,
          COUNT(CASE WHEN refresh_token_expires_at < NOW() THEN 1 END) as expired
        FROM sessions
      `;
      const params = [];
      
      if (userId) {
        query += ' WHERE user_id = $1';
        params.push(userId);
      }
      
      const result = await client.query(query, params);
      return result.rows[0];
    } finally {
      client.release();
    }
  }
}

module.exports = Session;
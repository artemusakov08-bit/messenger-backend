const SessionService = require('../services/sessionService');
const db = require('../config/database');

class DeviceMiddleware {
  // 📱 Проверка устройства и сессии
  async validateDeviceAndSession(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      const { userId, deviceId, sessionId } = req.user;
      
      // Проверяем сессию в БД
      const client = await db.getClient();
      try {
        const sessionResult = await client.query(
          `SELECT * FROM sessions 
           WHERE session_id = $1 AND user_id = $2 AND device_id = $3 
           AND is_active = true AND refresh_token_expires_at > NOW()`,
          [sessionId, userId, deviceId]
        );
        
        if (sessionResult.rows.length === 0) {
          return res.status(401).json({
            success: false,
            error: 'Сессия не найдена или истекла',
            code: 'SESSION_INVALID',
            requiresReauth: true
          });
        }

        const session = sessionResult.rows[0];
        
        // Проверяем access token expiration
        const now = new Date();
        const accessExpiresAt = new Date(session.access_token_expires_at);
        
        if (now > accessExpiresAt) {
          return res.status(401).json({
            success: false,
            error: 'Access token истек',
            code: 'ACCESS_TOKEN_EXPIRED',
            canRefresh: true,
            expiresAt: accessExpiresAt
          });
        }

        // Проверяем refresh token expiration
        const refreshExpiresAt = new Date(session.refresh_token_expires_at);
        
        if (now > refreshExpiresAt) {
          await client.query(
            'UPDATE sessions SET is_active = false WHERE session_id = $1',
            [sessionId]
          );
          
          return res.status(401).json({
            success: false,
            error: 'Сессия истекла. Требуется повторный вход.',
            code: 'SESSION_EXPIRED',
            requiresReauth: true
          });
        }

        // Проверяем IP если включено
        if (process.env.ENFORCE_IP_CHECK === 'true' && session.ip_address) {
          const allowedIps = JSON.parse(session.device_info || '{}').trustedIps || [];
          
          if (allowedIps.length > 0 && !allowedIps.includes(req.ip)) {
            console.warn(`⚠️ Подозрительный IP: ${req.ip} для сессии ${sessionId}`);
            
            // Можно отправлять уведомление пользователю
            const notificationSocket = require('../sockets/notificationSocket').getNotificationSocket();
            notificationSocket.notifyDevice(userId, deviceId, {
              type: 'SUSPICIOUS_IP',
              sessionId: sessionId,
              ip: req.ip,
              expectedIp: session.ip_address,
              timestamp: now.toISOString()
            });
          }
        }

        // Обновляем время активности (не чаще чем раз в 5 минут)
        const lastActive = new Date(session.last_active_at);
        const minutesSinceLastActive = (now - lastActive) / (1000 * 60);
        
        if (minutesSinceLastActive > 5) {
          await client.query(
            'UPDATE sessions SET last_active_at = $1 WHERE session_id = $2',
            [now, sessionId]
          );
        }

        // Добавляем информацию о сессии в запрос
        req.sessionData = {
          id: session.session_id,
          deviceId: session.device_id,
          deviceName: session.device_name,
          ipAddress: session.ip_address,
          location: session.location ? JSON.parse(session.location) : null,
          createdAt: session.created_at,
          lastActiveAt: session.last_active_at,
          accessTokenExpiresAt: session.access_token_expires_at,
          refreshTokenExpiresAt: session.refresh_token_expires_at
        };

        next();
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Ошибка проверки устройства и сессии:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки сессии',
        code: 'SESSION_VALIDATION_ERROR'
      });
    }
  }

  // 🔄 Проверка возможности обновления токена
  async canRefreshToken(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      const { userId, deviceId, sessionId } = req.user;
      
      const client = await db.getClient();
      try {
        const sessionResult = await client.query(
          `SELECT refresh_token_expires_at FROM sessions 
           WHERE session_id = $1 AND user_id = $2 AND device_id = $3 
           AND is_active = true`,
          [sessionId, userId, deviceId]
        );
        
        if (sessionResult.rows.length === 0) {
          return res.status(401).json({
            success: false,
            error: 'Сессия не найдена',
            code: 'SESSION_NOT_FOUND'
          });
        }

        const session = sessionResult.rows[0];
        const now = new Date();
        const refreshExpiresAt = new Date(session.refresh_token_expires_at);
        
        if (now > refreshExpiresAt) {
          return res.status(401).json({
            success: false,
            error: 'Refresh token истек',
            code: 'REFRESH_TOKEN_EXPIRED',
            requiresReauth: true
          });
        }

        // Проверяем, не слишком ли часто обновляем
        const lastRefreshResult = await client.query(
          'SELECT COUNT(*) as count FROM token_refresh_log WHERE session_id = $1 AND created_at > NOW() - INTERVAL \'1 hour\'',
          [sessionId]
        );
        
        const refreshCount = parseInt(lastRefreshResult.rows[0].count);
        
        if (refreshCount > 10) {
          return res.status(429).json({
            success: false,
            error: 'Слишком частые обновления токена',
            code: 'TOKEN_REFRESH_LIMIT',
            retryAfter: 300 // 5 минут
          });
        }

        // Логируем обновление
        await client.query(
          'INSERT INTO token_refresh_log (session_id, ip_address, user_agent) VALUES ($1, $2, $3)',
          [sessionId, req.ip, req.headers['user-agent']]
        );

        next();
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Ошибка проверки обновления токена:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки возможности обновления',
        code: 'REFRESH_CHECK_ERROR'
      });
    }
  }

  // 🚫 Завершение всех других сессий (безопасная проверка)
  async canTerminateOtherSessions(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      const { userId, deviceId } = req.user;
      
      const client = await db.getClient();
      try {
        // Проверяем 2FA для этой операции если включена
        const securityResult = await client.query(
          'SELECT two_fa_enabled FROM user_security WHERE user_id = $1',
          [userId]
        );
        
        const securitySettings = securityResult.rows[0];
        
        if (securitySettings?.two_fa_enabled && !req.twoFAVerified) {
          return res.status(400).json({
            success: false,
            error: 'Для завершения всех сессий требуется 2FA',
            code: '2FA_REQUIRED_FOR_TERMINATION',
            userId: userId
          });
        }

        // Проверяем, есть ли другие активные сессии
        const otherSessionsResult = await client.query(
          `SELECT COUNT(*) as count FROM sessions 
           WHERE user_id = $1 AND device_id != $2 
           AND is_active = true AND refresh_token_expires_at > NOW()`,
          [userId, deviceId]
        );
        
        const otherSessionsCount = parseInt(otherSessionsResult.rows[0].count);
        
        if (otherSessionsCount === 0) {
          return res.status(400).json({
            success: false,
            error: 'Нет других активных сессий',
            code: 'NO_OTHER_SESSIONS',
            info: 'Все сессии кроме текущей уже завершены'
          });
        }

        req.otherSessionsCount = otherSessionsCount;
        next();
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Ошибка проверки завершения сессий:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки возможности завершения сессий',
        code: 'TERMINATION_CHECK_ERROR'
      });
    }
  }
}

module.exports = new DeviceMiddleware();
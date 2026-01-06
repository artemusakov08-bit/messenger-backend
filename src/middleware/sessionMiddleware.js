const sessionService = require('../services/sessionService');
const db = require('../config/database');

const sessionMiddleware = {
  // 🔐 Аутентификация по access token
  authenticate: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация'
        });
      }
      
      const accessToken = authHeader.split(' ')[1];
      
      // Валидируем access token через сервис сессий
      const validationResult = await sessionService.validateAccessToken(
        accessToken,
        req.ip
      );
      
      if (!validationResult.valid) {
        return res.status(401).json({
          success: false,
          error: 'Неверный или истекший токен',
          reason: validationResult.reason
        });
      }
      
      // Получаем данные пользователя из базы
      const client = await db.getClient();
      try {
        const userResult = await client.query(
          'SELECT user_id, username, display_name, phone, role, status, auth_level FROM users WHERE user_id = $1',
          [validationResult.userId]
        );
        
        if (userResult.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Пользователь не найден'
          });
        }
        
        const user = userResult.rows[0];
        
        // Добавляем данные в req.user
        req.user = {
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name,
          phone: user.phone,
          role: user.role,
          authLevel: user.auth_level,
          deviceId: validationResult.deviceId,
          sessionId: validationResult.sessionId,
          accessToken: accessToken
        };
        
        next();
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ Ошибка аутентификации:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка аутентификации'
      });
    }
  },

  // 🔄 Проверка refresh token
  validateRefreshToken: async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token обязателен'
        });
      }
      
      // Проверяем refresh token через сервис
      const tokenResult = await sessionService.validateRefreshToken(refreshToken);
      
      if (!tokenResult.valid) {
        return res.status(401).json({
          success: false,
          error: 'Неверный refresh token'
        });
      }
      
      req.refreshTokenData = tokenResult.decoded;
      next();
      
    } catch (error) {
      console.error('❌ Ошибка валидации refresh token:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка валидации токена'
      });
    }
  },

  // 👮 Проверка роли
  requireRole: (roles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация'
        });
      }
      
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Доступ запрещен'
        });
      }
      
      next();
    };
  },

  // 📱 Привязка к устройству (дополнительная проверка)
  requireDevice: async (req, res, next) => {
    try {
      const { userId, deviceId } = req.user;
      const requestedDeviceId = req.params.deviceId || req.body.deviceId;
      
      if (requestedDeviceId && requestedDeviceId !== deviceId) {
        // Проверяем, есть ли у пользователя такая сессия
        const sessions = await sessionService.getUserSessions(userId);
        const hasSession = sessions.some(s => s.deviceId === requestedDeviceId);
        
        if (!hasSession) {
          return res.status(403).json({
            success: false,
            error: 'Доступ с этого устройства запрещен'
          });
        }
      }
      
      next();
    } catch (error) {
      console.error('❌ Ошибка проверки устройства:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки устройства'
      });
    }
  },

  // 🛡️ Проверка безопасности (2FA если требуется)
  requireSecurity: async (req, res, next) => {
    try {
      const { userId } = req.user;
      
      // Получаем настройки безопасности пользователя
      const { UserSecurity } = require('../models');
      const securitySettings = await UserSecurity.findByUserId(userId);
      
      if (!securitySettings) {
        return next();
      }
      
      // Если включена 2FA, проверяем header
      if (securitySettings.two_fa_enabled) {
        const twoFAToken = req.headers['x-2fa-token'];
        
        if (!twoFAToken) {
          return res.status(403).json({
            success: false,
            error: 'Требуется 2FA аутентификация',
            requires2FA: true
          });
        }
        
        // Проверяем 2FA токен (упрощенно)
        const jwtUtils = require('../utils/jwtUtils');
        const tokenResult = jwtUtils.verifyToken(twoFAToken);
        
        if (!tokenResult.valid || tokenResult.decoded.type !== '2fa_verified') {
          return res.status(401).json({
            success: false,
            error: 'Неверный 2FA токен'
          });
        }
      }
      
      next();
    } catch (error) {
      console.error('❌ Ошибка проверки безопасности:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки безопасности'
      });
    }
  }
};

module.exports = sessionMiddleware;
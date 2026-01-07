const Session = require('../models/Session');
const db = require('../config/database');

const deviceAuthMiddleware = {
  // Проверка устройства
  authenticateDevice: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация устройства'
        });
      }
      
      const deviceToken = authHeader.split(' ')[1];
      
      // Проверяем токен устройства (упрощенно)
      const jwt = require('jsonwebtoken');
      const decoded = jwt.decode(deviceToken);
      
      if (!decoded || !decoded.deviceId) {
        return res.status(401).json({
          success: false,
          error: 'Неверный токен устройства'
        });
      }
      
      const { deviceId, userId } = decoded;
      
      // Проверяем существование сессии
      const session = await Session.findByDevice(userId, deviceId);
      
      if (!session || !session.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Устройство не авторизовано'
        });
      }
      
      req.device = {
        deviceId,
        userId,
        sessionId: session.session_id
      };
      
      next();
    } catch (error) {
      console.error('❌ Ошибка аутентификации устройства:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка аутентификации устройства'
      });
    }
  },

  // Проверка сессии устройства
  validateSession: async (req, res, next) => {
    try {
      const { deviceId, userId } = req.device || {};
      
      if (!deviceId || !userId) {
        return res.status(401).json({
          success: false,
          error: 'Данные устройства отсутствуют'
        });
      }
      
      const session = await Session.findByDevice(userId, deviceId);
      
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Сессия устройства не найдена'
        });
      }
      
      if (!session.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Сессия устройства неактивна'
        });
      }
      
      if (Session.isAccessTokenExpired(session)) {
        return res.status(401).json({
          success: false,
          error: 'Сессия устройства истекла'
        });
      }
      
      req.session = session;
      next();
    } catch (error) {
      console.error('❌ Ошибка валидации сессии:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка валидации сессии'
      });
    }
  }
};

module.exports = deviceAuthMiddleware;
const sessionService = require('../services/sessionService');
const db = require('../config/database');

class SessionMiddleware {
  // 🔐 Аутентификация
  async authenticate(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация'
        });
      }
      
      const accessToken = authHeader.split(' ')[1];
      
      // Валидируем токен
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
      
      // Получаем данные пользователя
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
        
        // Добавляем в запрос
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
  }

  // 👮 Проверка роли
  requireRole(roles) {
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
  }

  // 📱 Привязка к устройству
  async requireDevice(req, res, next) {
    try {
      const { userId, deviceId } = req.user;
      const requestedDeviceId = req.params.deviceId || req.body.deviceId;
      
      if (requestedDeviceId && requestedDeviceId !== deviceId) {
        const client = await db.getClient();
        try {
          const result = await client.query(
            'SELECT * FROM sessions WHERE user_id = $1 AND device_id = $2 AND is_active = true',
            [userId, requestedDeviceId]
          );
          
          if (result.rows.length === 0) {
            return res.status(403).json({
              success: false,
              error: 'Доступ с этого устройства запрещен'
            });
          }
        } finally {
          client.release();
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
  }
}

module.exports = new SessionMiddleware();
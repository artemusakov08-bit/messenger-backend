const jwtUtils = require('../utils/jwtUtils');
const Session = require('../models/Session');

class DeviceAuthMiddleware {
  // 🔐 Аутентификация по access token
  async authenticate(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация',
          code: 'MISSING_TOKEN'
        });
      }
      
      const accessToken = authHeader.split(' ')[1];
      
      // Проверяем access token
      const tokenResult = jwtUtils.verifyAccessToken(accessToken);
      
      if (!tokenResult.valid) {
        // Если токен истек, возвращаем специальный код для обновления
        if (tokenResult.error === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            error: 'Access token истек',
            code: 'ACCESS_TOKEN_EXPIRED',
            canRefresh: true
          });
        }
        
        return res.status(401).json({
          success: false,
          error: 'Неверный токен',
          code: 'INVALID_TOKEN'
        });
      }
      
      const { userId, deviceId, sessionId, deviceName } = tokenResult.decoded;
      
      // Ищем активную сессию
      const session = await Session.findByAccessToken(accessToken);
      
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Сессия не найдена',
          code: 'SESSION_NOT_FOUND'
        });
      }
      
      if (!session.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Сессия неактивна',
          code: 'SESSION_INACTIVE'
        });
      }
      
      // Проверяем sessionId в токене совпадает с хэшом сессии в БД
      if (!jwtUtils.verifySessionToken(session.session_token, sessionId)) {
        return res.status(401).json({
          success: false,
          error: 'Несоответствие сессии',
          code: 'SESSION_MISMATCH'
        });
      }
      
      // Проверяем устройство
      if (session.device_id !== deviceId) {
        return res.status(401).json({
          success: false,
          error: 'Несоответствие устройства',
          code: 'DEVICE_MISMATCH'
        });
      }
      
      // Проверяем срок действия access токена в БД
      const now = new Date();
      const tokenExpiresAt = new Date(session.access_token_expires_at);
      
      if (now > tokenExpiresAt) {
        return res.status(401).json({
          success: false,
          error: 'Токен истек',
          code: 'TOKEN_EXPIRED',
          canRefresh: true
        });
      }
      
      // Добавляем данные в запрос
      req.user = {
        userId: session.user_id,
        deviceId: session.device_id,
        deviceName: session.device_name,
        sessionId: session.session_id,
        accessToken: accessToken
      };
      
      req.session = session;
      
      next();
    } catch (error) {
      console.error('❌ Ошибка аутентификации:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка аутентификации',
        code: 'AUTH_ERROR'
      });
    }
  }

  // 🔄 Middleware для обновления токена при истечении
  async withTokenRefresh(req, res, next) {
    try {
      await this.authenticate(req, res, (err) => {
        if (err) {
          // Если токен истек, пробуем обновить
          if (err.code === 'ACCESS_TOKEN_EXPIRED' || err.code === 'TOKEN_EXPIRED') {
            return this.handleTokenRefresh(req, res, next);
          }
          return res.status(err.status || 401).json(err);
        }
        next();
      });
    } catch (error) {
      next(error);
    }
  }

  // 🔄 Обработка обновления токена
  async handleTokenRefresh(req, res, next) {
    try {
      const refreshToken = req.headers['x-refresh-token'] || req.cookies?.refreshToken;
      
      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          error: 'Требуется refresh token',
          code: 'REFRESH_TOKEN_REQUIRED'
        });
      }
      
      // Проверяем refresh token
      const tokenResult = jwtUtils.verifyRefreshToken(refreshToken);
      
      if (!tokenResult.valid) {
        return res.status(401).json({
          success: false,
          error: 'Неверный refresh token',
          code: 'INVALID_REFRESH_TOKEN'
        });
      }
      
      const { userId, deviceId } = tokenResult.decoded;
      
      // Ищем сессию по refresh token
      const session = await Session.findByRefreshToken(refreshToken);
      
      if (!session || !session.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Сессия не найдена',
          code: 'SESSION_NOT_FOUND'
        });
      }
      
      // Генерируем новую пару токенов
      const tokens = jwtUtils.generateTokenPair(userId, deviceId, session.device_name);
      
      // Обновляем сессию
      const updatedSession = await Session.updateTokens(
        session.session_id,
        {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          sessionToken: tokens.sessionToken
        },
        req.ip
      );
      
      if (!updatedSession) {
        throw new Error('Не удалось обновить токены');
      }
      
      // Устанавливаем новые токены в заголовки
      res.set('X-New-Access-Token', tokens.accessToken);
      res.set('X-New-Refresh-Token', tokens.refreshToken);
      
      // Добавляем данные в запрос
      req.user = {
        userId: updatedSession.user_id,
        deviceId: updatedSession.device_id,
        deviceName: updatedSession.device_name,
        sessionId: updatedSession.session_id,
        accessToken: tokens.accessToken
      };
      
      req.session = updatedSession;
      req.tokenRefreshed = true;
      
      next();
    } catch (error) {
      console.error('❌ Ошибка обновления токена:', error);
      res.status(401).json({
        success: false,
        error: 'Не удалось обновить токен',
        code: 'TOKEN_REFRESH_FAILED'
      });
    }
  }

  // 📱 Проверка устройства (дополнительная защита)
  async validateDevice(req, res, next) {
    try {
      const { deviceId, userId } = req.user || {};
      
      if (!deviceId || !userId) {
        return res.status(401).json({
          success: false,
          error: 'Данные устройства отсутствуют',
          code: 'DEVICE_DATA_MISSING'
        });
      }
      
      const session = await Session.findByDevice(userId, deviceId);
      
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Устройство не авторизовано',
          code: 'DEVICE_NOT_AUTHORIZED'
        });
      }
      
      if (!session.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Сессия устройства неактивна',
          code: 'DEVICE_SESSION_INACTIVE'
        });
      }
      
      // Проверяем IP (опционально, для повышенной безопасности)
      if (process.env.ENFORCE_IP_CHECK === 'true') {
        const trustedIps = JSON.parse(session.device_info || '{}').trustedIps || [];
        const currentIp = req.ip;
        
        if (!trustedIps.includes(currentIp) && trustedIps.length > 0) {
          console.warn(`⚠️ Подозрительный IP: ${currentIp} для устройства ${deviceId}`);
          // Можно отправить уведомление пользователю
        }
      }
      
      next();
    } catch (error) {
      console.error('❌ Ошибка валидации устройства:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки устройства',
        code: 'DEVICE_VALIDATION_ERROR'
      });
    }
  }
}

module.exports = new DeviceAuthMiddleware();
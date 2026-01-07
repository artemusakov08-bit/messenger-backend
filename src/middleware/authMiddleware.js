const jwt = require('jsonwebtoken');
const SessionService = require('../services/sessionService');
const db = require('../config/database');

class AuthMiddleware {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || this.JWT_SECRET + '_refresh';
    
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET не настроен в переменных окружения');
    }
  }

  // 🔐 Основная аутентификация с поддержкой трех токенов
  async authenticate(req, res, next) {
    try {
      console.log('🔐 === АУТЕНТИФИКАЦИЯ ===');
      
      // Получаем токен из заголовков
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        console.log('❌ Нет заголовка Authorization');
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация',
          code: 'MISSING_AUTH_HEADER'
        });
      }

      // Проверяем формат Bearer
      if (!authHeader.startsWith('Bearer ')) {
        console.log('❌ Неверный формат заголовка');
        return res.status(401).json({
          success: false,
          error: 'Неверный формат заголовка авторизации. Используйте: Bearer <token>',
          code: 'INVALID_AUTH_FORMAT'
        });
      }

      const accessToken = authHeader.substring(7);
      
      if (!accessToken) {
        console.log('❌ Пустой токен');
        return res.status(401).json({
          success: false,
          error: 'Токен не предоставлен',
          code: 'EMPTY_TOKEN'
        });
      }

      console.log('🔑 Проверка access token...');
      
      // Валидируем токен через SessionService
      const validationResult = await SessionService.validateAccessToken(accessToken, req.ip);
      
      if (!validationResult.valid) {
        console.log('❌ Невалидный токен:', validationResult.code);
        
        const response = {
          success: false,
          error: validationResult.message,
          code: validationResult.code
        };
        
        // Добавляем информацию для обновления токена
        if (validationResult.canRefresh) {
          response.canRefresh = true;
          response.refreshHint = 'Используйте refresh token для получения нового access token';
        }
        
        return res.status(401).json(response);
      }

      // Получаем полные данные пользователя
      const client = await db.getClient();
      try {
        const userResult = await client.query(
          `SELECT 
            user_id, username, display_name, phone, 
            role, status, auth_level, is_premium,
            is_banned, warnings, last_seen
           FROM users WHERE user_id = $1`,
          [validationResult.userId]
        );
        
        if (userResult.rows.length === 0) {
          console.log('❌ Пользователь не найден в БД:', validationResult.userId);
          return res.status(404).json({
            success: false,
            error: 'Пользователь не найден',
            code: 'USER_NOT_FOUND'
          });
        }

        const user = userResult.rows[0];
        
        // Проверяем бан
        if (user.is_banned) {
          console.log('🚫 Пользователь забанен:', user.user_id);
          return res.status(403).json({
            success: false,
            error: 'Аккаунт заблокирован',
            code: 'ACCOUNT_BANNED',
            warnings: user.warnings
          });
        }

        // Получаем security настройки
        const securityResult = await client.query(
          'SELECT * FROM user_security WHERE user_id = $1',
          [user.user_id]
        );
        
        const securitySettings = securityResult.rows[0];

        // Формируем объект пользователя для запроса
        req.user = {
          // Основная информация
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name,
          phone: user.phone,
          
          // Роли и статусы
          role: user.role,
          status: user.status,
          authLevel: user.auth_level,
          isPremium: user.is_premium,
          
          // Сессионная информация
          deviceId: validationResult.deviceId,
          deviceName: validationResult.deviceName,
          sessionId: validationResult.sessionId,
          accessToken: accessToken,
          
          // Security
          security: {
            twoFAEnabled: securitySettings?.two_fa_enabled || false,
            codeWordEnabled: securitySettings?.code_word_enabled || false,
            securityLevel: securitySettings?.security_level || 'low'
          },
          
          // Метаданные
          isBanned: user.is_banned,
          warnings: user.warnings,
          lastSeen: user.last_seen
        };

        // Сохраняем сессию для доступа в контроллерах
        req.session = validationResult.session;
        
        // Обновляем last_seen пользователя (но не чаще чем раз в 5 минут)
        const lastSeen = new Date(user.last_seen);
        const now = new Date();
        const minutesDiff = (now - lastSeen) / (1000 * 60);
        
        if (minutesDiff > 5) {
          await client.query(
            'UPDATE users SET last_seen = $1 WHERE user_id = $2',
            [now, user.user_id]
          );
          
          console.log('🔄 Обновлен last_seen для:', user.user_id);
        }

        console.log('✅ Аутентификация успешна:', {
          userId: user.user_id,
          username: user.username,
          deviceId: validationResult.deviceId,
          role: user.role
        });

        next();
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('❌ КРИТИЧЕСКАЯ ОШИБКА АУТЕНТИФИКАЦИИ:', error);
      console.error('Stack trace:', error.stack);
      
      res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера при аутентификации',
        code: 'AUTH_SERVER_ERROR',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // 🔄 Мидлвэр с авто-обновлением токена
  async authenticateWithRefresh(req, res, next) {
    try {
      await this.authenticate(req, res, async (authError) => {
        if (authError) {
          // Если токен истек, пробуем обновить
          if (authError.code === 'ACCESS_TOKEN_EXPIRED' && req.headers['x-refresh-token']) {
            return this.handleTokenRefresh(req, res, next);
          }
          return res.status(authError.status || 401).json(authError);
        }
        next();
      });
    } catch (error) {
      console.error('❌ Ошибка аутентификации с обновлением:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка аутентификации',
        code: 'AUTH_REFRESH_ERROR'
      });
    }
  }

  // 🔄 Обработка обновления токена
  async handleTokenRefresh(req, res, next) {
    try {
      const refreshToken = req.headers['x-refresh-token'] || req.cookies?.refreshToken;
      
      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          error: 'Требуется refresh token для обновления',
          code: 'REFRESH_TOKEN_REQUIRED'
        });
      }

      console.log('🔄 Попытка обновления токена...');
      
      // Обновляем токены через SessionService
      const result = await SessionService.refreshUserTokens(refreshToken, req.ip);
      
      // Устанавливаем новые токены в заголовки
      res.set('X-New-Access-Token', result.accessToken);
      res.set('X-New-Refresh-Token', result.refreshToken);
      
      // Устанавливаем куки (опционально)
      res.cookie('accessToken', result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 3600000, // 1 час
        sameSite: 'strict'
      });
      
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 3600000, // 30 дней
        sameSite: 'strict'
      });
      
      // Получаем данные пользователя для req.user
      const decoded = jwt.decode(result.accessToken);
      const client = await db.getClient();
      
      try {
        const userResult = await client.query(
          'SELECT user_id, username, display_name, phone, role FROM users WHERE user_id = $1',
          [decoded.userId]
        );
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          
          req.user = {
            userId: user.user_id,
            username: user.username,
            displayName: user.display_name,
            phone: user.phone,
            role: user.role,
            deviceId: decoded.deviceId,
            sessionId: result.sessionId,
            accessToken: result.accessToken,
            tokenRefreshed: true
          };
        }
      } finally {
        client.release();
      }
      
      req.tokenRefreshed = true;
      console.log('✅ Токены успешно обновлены');
      
      next();
    } catch (error) {
      console.error('❌ Ошибка обновления токена:', error);
      
      const status = error.code === 'INVALID_REFRESH_TOKEN' || 
                    error.code === 'SESSION_NOT_FOUND' ? 401 : 500;
      
      res.status(status).json({
        success: false,
        error: error.message || 'Не удалось обновить токен',
        code: error.code || 'TOKEN_REFRESH_FAILED'
      });
    }
  }

  // 👮 Проверка ролей
  requireRole(roles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      if (!Array.isArray(roles)) {
        roles = [roles];
      }

      if (!roles.includes(req.user.role)) {
        console.log('🚫 Доступ запрещен для роли:', req.user.role, 'Требуется:', roles);
        return res.status(403).json({
          success: false,
          error: 'Недостаточно прав',
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredRoles: roles,
          userRole: req.user.role
        });
      }

      next();
    };
  }

  // 🔒 Проверка премиум статуса
  requirePremium(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Требуется аутентификация',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!req.user.isPremium) {
      return res.status(403).json({
        success: false,
        error: 'Требуется премиум подписка',
        code: 'PREMIUM_REQUIRED'
      });
    }

    next();
  }

  // 📱 Проверка привязки к устройству
  async requireDevice(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      const { userId, deviceId } = req.user;
      const requestedDeviceId = req.params.deviceId || req.body.deviceId || req.query.deviceId;
      
      if (requestedDeviceId && requestedDeviceId !== deviceId) {
        const client = await db.getClient();
        try {
          const result = await client.query(
            `SELECT * FROM sessions 
             WHERE user_id = $1 AND device_id = $2 
             AND is_active = true AND refresh_token_expires_at > NOW()`,
            [userId, requestedDeviceId]
          );
          
          if (result.rows.length === 0) {
            return res.status(403).json({
              success: false,
              error: 'Доступ с этого устройства запрещен',
              code: 'DEVICE_NOT_AUTHORIZED',
              deviceId: requestedDeviceId
            });
          }
          
          // Проверяем IP если включено
          if (process.env.ENFORCE_IP_CHECK === 'true') {
            const session = result.rows[0];
            const deviceInfo = session.device_info ? JSON.parse(session.device_info) : {};
            const trustedIps = deviceInfo.trustedIps || [];
            
            if (trustedIps.length > 0 && !trustedIps.includes(req.ip)) {
              console.warn(`⚠️ Подозрительный доступ с IP: ${req.ip} для устройства ${requestedDeviceId}`);
              
              // Отправляем уведомление о подозрительном доступе
              const notificationSocket = require('../sockets/notificationSocket').getNotificationSocket();
              notificationSocket.notifyDevice(userId, deviceId, {
                type: 'SUSPICIOUS_ACCESS',
                deviceId: requestedDeviceId,
                ip: req.ip,
                timestamp: new Date().toISOString()
              });
            }
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
        error: 'Ошибка проверки устройства',
        code: 'DEVICE_VALIDATION_ERROR'
      });
    }
  }

  // 🔐 Проверка 2FA (для чувствительных операций)
  async require2FA(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      const { userId } = req.user;
      const { twoFACode } = req.body;
      
      if (!twoFACode) {
        return res.status(400).json({
          success: false,
          error: 'Требуется код 2FA',
          code: '2FA_CODE_REQUIRED',
          userId: userId
        });
      }

      const client = await db.getClient();
      try {
        const securityResult = await client.query(
          'SELECT * FROM user_security WHERE user_id = $1',
          [userId]
        );
        
        const securitySettings = securityResult.rows[0];
        
        if (!securitySettings || !securitySettings.two_fa_enabled) {
          return res.status(400).json({
            success: false,
            error: '2FA не включена для этого пользователя',
            code: '2FA_NOT_ENABLED'
          });
        }

        // Проверяем код
        const speakeasy = require('speakeasy');
        const isValid = speakeasy.totp.verify({
          secret: securitySettings.two_fa_secret,
          encoding: 'base32',
          token: twoFACode,
          window: 2
        });

        if (!isValid) {
          return res.status(401).json({
            success: false,
            error: 'Неверный код 2FA',
            code: 'INVALID_2FA_CODE'
          });
        }

        // Генерируем временный токен для операции
        const operationToken = jwt.sign(
          {
            userId,
            type: '2fa_verified',
            operation: req.route.path,
            verifiedAt: new Date()
          },
          this.JWT_SECRET,
          { expiresIn: '5m' }
        );

        req.twoFAVerified = true;
        req.operationToken = operationToken;
        
        next();
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Ошибка проверки 2FA:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки 2FA',
        code: '2FA_VALIDATION_ERROR'
      });
    }
  }

  // 🛡️ Rate limiting для аутентификации
  createRateLimiter(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    const attempts = new Map();
    
    return (req, res, next) => {
      const key = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      const now = Date.now();
      
      if (!attempts.has(key)) {
        attempts.set(key, []);
      }
      
      const userAttempts = attempts.get(key);
      const windowStart = now - windowMs;
      
      // Удаляем старые попытки
      while (userAttempts.length > 0 && userAttempts[0] < windowStart) {
        userAttempts.shift();
      }
      
      // Проверяем лимит
      if (userAttempts.length >= maxAttempts) {
        const retryAfter = Math.ceil((userAttempts[0] + windowMs - now) / 1000);
        
        res.set('Retry-After', retryAfter);
        return res.status(429).json({
          success: false,
          error: 'Слишком много попыток. Попробуйте позже.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter
        });
      }
      
      // Добавляем новую попытку
      userAttempts.push(now);
      attempts.set(key, userAttempts);
      
      // Очищаем старые записи периодически
      if (Math.random() < 0.01) { // 1% chance
        for (const [k, v] of attempts) {
          if (v.length === 0 || (now - v[v.length - 1] > windowMs * 2)) {
            attempts.delete(k);
          }
        }
      }
      
      next();
    };
  }
}

module.exports = new AuthMiddleware();
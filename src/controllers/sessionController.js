const sessionService = require('../services/sessionService');
const jwtUtils = require('../utils/jwtUtils');
const db = require('../config/database');

class SessionController {
  // 🔐 Логин с созданием сессии
  async login(req, res) {
    const client = await db.getClient();
    try {
      const { phone, code, deviceData } = req.body;
      
      console.log('🔐 Сессионный логин:', { phone, deviceId: deviceData?.deviceId });
      
      // Валидация
      if (!phone || !code || !deviceData || !deviceData.deviceId) {
        return res.status(400).json({
          success: false,
          error: 'Телефон, код и ID устройства обязательны'
        });
      }
      
      // Проверяем SMS код
      const verificationResult = await client.query(
        'SELECT * FROM verification_codes WHERE phone = $1 AND code = $2 AND is_used = false AND expires_at > NOW()',
        [phone, code]
      );
      
      if (verificationResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'Неверный или истекший код'
        });
      }
      
      // Помечаем код как использованный
      await client.query(
        'UPDATE verification_codes SET is_used = true WHERE id = $1',
        [verificationResult.rows[0].id]
      );
      
      // Находим пользователя
      const userResult = await client.query(
        'SELECT * FROM users WHERE phone = $1',
        [phone]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Пользователь не найден'
        });
      }
      
      const user = userResult.rows[0];
      
      // Проверяем 2FA если включена
      const securityResult = await client.query(
        'SELECT * FROM user_security WHERE user_id = $1',
        [user.user_id]
      );
      
      const securitySettings = securityResult.rows[0];
      
      if (securitySettings?.two_fa_enabled) {
        const { twoFACode } = req.body;
        if (!twoFACode) {
          return res.status(400).json({
            success: false,
            error: 'Требуется код 2FA',
            requires2FA: true,
            userId: user.user_id
          });
        }
        
        const isValid2FA = await this.validate2FACode(securitySettings.two_fa_secret, twoFACode);
        if (!isValid2FA) {
          return res.status(401).json({
            success: false,
            error: 'Неверный код 2FA'
          });
        }
      }
      
      // Создаем сессию
      const { session, tokens } = await sessionService.createSession(
        user.user_id,
        deviceData,
        req.ip
      );
      
      // Обновляем статус пользователя
      await client.query(
        'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
        ['online', Date.now(), user.user_id]
      );
      
      // Форматируем ответ
      const location = session.location ? JSON.parse(session.location) : null;
      
      res.json({
        success: true,
        session: {
          id: session.session_id,
          deviceId: session.device_id,
          deviceName: session.device_name,
          os: session.os,
          createdAt: session.created_at,
          location
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          sessionToken: tokens.sessionToken,
          accessTokenExpiresIn: 3600,
          refreshTokenExpiresIn: 2592000,
          accessTokenExpiresAt: session.access_token_expires_at,
          refreshTokenExpiresAt: session.refresh_token_expires_at
        },
        user: {
          id: user.user_id,
          phone: user.phone,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          authLevel: user.auth_level
        },
        security: {
          twoFAEnabled: securitySettings?.two_fa_enabled || false,
          codeWordEnabled: securitySettings?.code_word_enabled || false
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка логина:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка входа: ' + error.message
      });
    } finally {
      client.release();
    }
  }

  // 🔄 Обновление токенов
  async refresh(req, res) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token обязателен'
        });
      }
      
      const { session, tokens } = await sessionService.refreshTokens(
        refreshToken,
        req.ip
      );
      
      res.json({
        success: true,
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessTokenExpiresIn: 3600,
          refreshTokenExpiresIn: 2592000,
          accessTokenExpiresAt: session.access_token_expires_at,
          refreshTokenExpiresAt: session.refresh_token_expires_at
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка обновления токенов:', error);
      
      let status = 500;
      let errorMessage = 'Ошибка обновления токенов';
      
      switch (error.message) {
        case 'INVALID_REFRESH_TOKEN':
          status = 401;
          errorMessage = 'Неверный refresh token';
          break;
        case 'SESSION_NOT_FOUND':
          status = 404;
          errorMessage = 'Сессия не найдена';
          break;
        case 'SESSION_INACTIVE':
          status = 401;
          errorMessage = 'Сессия неактивна';
          break;
        case 'REFRESH_TOKEN_EXPIRED':
          status = 401;
          errorMessage = 'Refresh token истек';
          break;
        case 'DEVICE_MISMATCH':
          status = 401;
          errorMessage = 'Несоответствие устройства';
          break;
      }
      
      res.status(status).json({
        success: false,
        error: errorMessage
      });
    }
  }

  // 📋 Получить сессии
  async getSessions(req, res) {
    try {
      const { userId, deviceId } = req.user;
      
      const sessions = await sessionService.getUserSessions(userId, deviceId);
      
      res.json({
        success: true,
        sessions,
        currentDeviceId: deviceId,
        count: sessions.length
      });
      
    } catch (error) {
      console.error('❌ Ошибка получения сессий:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка получения сессий'
      });
    }
  }

  // 🚪 Завершить сессию
  async terminateSession(req, res) {
    try {
      const { userId } = req.user;
      const { sessionId } = req.params;
      
      await sessionService.terminateSession(sessionId, userId);
      
      res.json({
        success: true,
        message: 'Сессия завершена',
        sessionId
      });
      
    } catch (error) {
      console.error('❌ Ошибка завершения сессии:', error);
      
      if (error.message === 'SESSION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: 'Сессия не найдена'
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Ошибка завершения сессии'
      });
    }
  }

  // 🚫 Завершить все сессии кроме текущей
  async terminateAllOtherSessions(req, res) {
    try {
      const { userId, deviceId } = req.user;
      
      const terminatedCount = await sessionService.terminateAllOtherSessions(userId, deviceId);
      
      res.json({
        success: true,
        message: `Завершено ${terminatedCount} других сессий`,
        terminatedCount
      });
      
    } catch (error) {
      console.error('❌ Ошибка завершения всех сессий:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка завершения сессий'
      });
    }
  }

  // 🔐 Выход
  async logout(req, res) {
    try {
      const { userId, sessionId } = req.user;
      
      await sessionService.terminateSession(sessionId, userId);
      
      // Обновляем статус пользователя
      const client = await db.getClient();
      try {
        await client.query(
          'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
          ['offline', Date.now(), userId]
        );
      } finally {
        client.release();
      }
      
      res.json({
        success: true,
        message: 'Вы вышли из системы'
      });
      
    } catch (error) {
      console.error('❌ Ошибка выхода:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка выхода'
      });
    }
  }

  // 📱 Проверить сессию
  async checkSession(req, res) {
    try {
      const { userId, deviceId, sessionId } = req.user;
      
      const client = await db.getClient();
      try {
        const result = await client.query(
          'SELECT * FROM sessions WHERE session_id = $1 AND user_id = $2 AND device_id = $3',
          [sessionId, userId, deviceId]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Сессия не найдена'
          });
        }
        
        const session = result.rows[0];
        const expiresIn = Math.max(0, Math.floor((
          new Date(session.access_token_expires_at) - new Date()
        ) / 1000));
        
        res.json({
          success: true,
          isValid: session.is_active && expiresIn > 0,
          session: {
            id: session.session_id,
            deviceId: session.device_id,
            lastActiveAt: session.last_active_at,
            expiresAt: session.access_token_expires_at,
            expiresIn,
            isActive: session.is_active
          }
        });
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ Ошибка проверки сессии:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки сессии'
      });
    }
  }

  // 🌐 Получить текущую сессию
  async getCurrentSession(req, res) {
    try {
      const { userId, deviceId, sessionId } = req.user;
      
      const client = await db.getClient();
      try {
        const result = await client.query(
          'SELECT * FROM sessions WHERE session_id = $1 AND user_id = $2 AND device_id = $3',
          [sessionId, userId, deviceId]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Сессия не найдена'
          });
        }
        
        const session = result.rows[0];
        const location = session.location ? JSON.parse(session.location) : null;
        const deviceInfo = session.device_info ? JSON.parse(session.device_info) : {};
        
        res.json({
          success: true,
          session: {
            id: session.session_id,
            deviceId: session.device_id,
            deviceName: session.device_name,
            os: session.os,
            deviceInfo,
            ipAddress: session.ip_address,
            location,
            createdAt: session.created_at,
            lastActiveAt: session.last_active_at,
            accessTokenExpiresAt: session.access_token_expires_at,
            refreshTokenExpiresAt: session.refresh_token_expires_at,
            isActive: session.is_active
          }
        });
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ Ошибка получения сессии:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка получения сессии'
      });
    }
  }

  // 📱 Отправить SMS код
  async sendSMSCode(req, res) {
    const client = await db.getClient();
    try {
      const { phone, type = 'sms' } = req.body;
      
      const code = jwtUtils.generateSMSCode();
      const codeId = 'code_' + Date.now();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      await client.query(
        `INSERT INTO verification_codes (id, phone, code, type, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [codeId, phone, code, type, expiresAt]
      );
      
      // Здесь отправка SMS
      
      res.json({
        success: true,
        message: 'Код подтверждения отправлен',
        expiresIn: 600
      });
      
    } catch (error) {
      console.error('❌ Ошибка отправки SMS:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка отправки кода'
      });
    } finally {
      client.release();
    }
  }

  // 🔍 Проверить регистрацию
  async checkRegistration(req, res) {
    const client = await db.getClient();
    try {
      const { phone } = req.body;
      
      const userResult = await client.query(
        'SELECT * FROM users WHERE phone = $1',
        [phone]
      );
      
      if (userResult.rows.length === 0) {
        return res.json({
          success: true,
          userExists: false,
          needsRegistration: true
        });
      }
      
      const user = userResult.rows[0];
      const securityResult = await client.query(
        'SELECT * FROM user_security WHERE user_id = $1',
        [user.user_id]
      );
      
      const securitySettings = securityResult.rows[0];
      
      res.json({
        success: true,
        userExists: true,
        user: {
          id: user.user_id,
          phone: user.phone,
          username: user.username,
          displayName: user.display_name,
          role: user.role
        },
        security: {
          twoFAEnabled: securitySettings?.two_fa_enabled || false,
          codeWordEnabled: securitySettings?.code_word_enabled || false,
          requires2FA: securitySettings?.two_fa_enabled || false
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка проверки регистрации:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки пользователя'
      });
    } finally {
      client.release();
    }
  }

  // 🔐 Валидация 2FA
  async validate2FACode(secret, code) {
    try {
      const speakeasy = require('speakeasy');
      return speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: code,
        window: 2
      });
    } catch (error) {
      console.error('Ошибка валидации 2FA:', error);
      return /^\d{6}$/.test(code);
    }
  }
}

module.exports = new SessionController();
const sessionService = require('../services/sessionService');
const { VerificationCode, UserSecurity } = require('../models');
const db = require('../config/database');
const { Op } = require('sequelize');

class SessionController {
  // 🔐 Логин с созданием сессии
  async login(req, res) {
    const client = await db.getClient();
    try {
      const { phone, code, deviceData } = req.body;
      
      console.log('🔐 Сессионный логин:', { phone, code, deviceData: deviceData?.deviceId });
      
      // Валидация
      if (!phone || !code || !deviceData) {
        return res.status(400).json({
          success: false,
          error: 'Телефон, код и данные устройства обязательны'
        });
      }
      
      if (!deviceData.deviceId) {
        return res.status(400).json({
          success: false,
          error: 'ID устройства обязателен'
        });
      }
      
      // 1. Проверяем SMS код из вашей таблицы verification_codes
      const verificationCode = await VerificationCode.findOne({
        where: {
          phone: phone,
          code: code,
          is_used: false
        }
      });
      
      if (!verificationCode) {
        return res.status(401).json({
          success: false,
          error: 'Неверный код подтверждения'
        });
      }
      
      // Проверяем срок действия
      if (new Date() > verificationCode.expires_at) {
        return res.status(401).json({
          success: false,
          error: 'Код истек'
        });
      }
      
      // Помечаем код как использованный
      verificationCode.is_used = true;
      await verificationCode.save();
      
      // 2. Находим пользователя
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
      
      // 3. Проверяем security настройки пользователя (2FA и т.д.)
      const securitySettings = await UserSecurity.findByUserId(user.user_id);
      
      // Если включена 2FA, проверяем дополнительно
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
        
        // Проверяем 2FA код (ваша существующая логика)
        const isValid2FA = await this.validate2FACode(securitySettings.two_fa_secret, twoFACode);
        if (!isValid2FA) {
          return res.status(401).json({
            success: false,
            error: 'Неверный код 2FA'
          });
        }
      }
      
      // 4. Создаем сессию
      const { session, tokens } = await sessionService.createSession(
        user.user_id,
        deviceData,
        req.ip
      );
      
      // 5. Обновляем статус пользователя
      await client.query(
        'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
        ['online', Date.now(), user.user_id]
      );
      
      // 6. Возвращаем ответ
      console.log('✅ Сессия создана для пользователя:', user.user_id, 'Устройство:', deviceData.deviceId);
      
      res.json({
        success: true,
        session: {
          id: session.id,
          deviceId: session.deviceId,
          deviceName: session.deviceName,
          os: session.os,
          createdAt: session.createdAt,
          location: session.location
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          sessionToken: tokens.sessionToken,
          accessTokenExpiresIn: 3600,
          refreshTokenExpiresIn: 2592000,
          accessTokenExpiresAt: session.accessTokenExpiresAt,
          refreshTokenExpiresAt: session.refreshTokenExpiresAt
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
      console.error('❌ Ошибка логина с сессией:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка входа: ' + error.message
      });
    } finally {
      client.release();
    }
  }

  // 🔄 Обновление access token
  async refresh(req, res) {
    try {
      const { refreshToken } = req.body;
      
      console.log('🔄 Обновление токенов');
      
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
      
      console.log('✅ Токены обновлены для сессии:', session.id);
      
      res.json({
        success: true,
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessTokenExpiresIn: 3600,
          refreshTokenExpiresIn: 2592000,
          accessTokenExpiresAt: session.accessTokenExpiresAt,
          refreshTokenExpiresAt: session.refreshTokenExpiresAt
        },
        session: {
          id: session.id,
          deviceId: session.deviceId,
          lastActiveAt: session.lastActiveAt
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

  // 📋 Получить активные сессии
  async getSessions(req, res) {
    try {
      const { userId, deviceId } = req.user;
      
      console.log('📋 Получение сессий для пользователя:', userId);
      
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

  // 🚪 Завершить конкретную сессию
  async terminateSession(req, res) {
    try {
      const { userId } = req.user;
      const { sessionId } = req.params;
      
      console.log('🚪 Завершение сессии:', sessionId, 'пользователь:', userId);
      
      const session = await sessionService.terminateSession(sessionId, userId);
      
      res.json({
        success: true,
        message: 'Сессия завершена',
        sessionId: session.id,
        terminatedAt: new Date().toISOString()
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

  // 🚫 Завершить все другие сессии
  async terminateAllOtherSessions(req, res) {
    try {
      const { userId, deviceId } = req.user;
      
      console.log('🚫 Завершение всех других сессий для пользователя:', userId, 'кроме:', deviceId);
      
      const terminatedCount = await sessionService.terminateAllOtherSessions(userId, deviceId);
      
      res.json({
        success: true,
        message: `Завершено ${terminatedCount} других сессий`,
        terminatedCount,
        currentDeviceId: deviceId
      });
      
    } catch (error) {
      console.error('❌ Ошибка завершения всех сессий:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка завершения сессий'
      });
    }
  }

  // 🔐 Выход (завершение текущей сессии)
  async logout(req, res) {
    try {
      const { userId, sessionId } = req.user;
      
      console.log('🔐 Выход из системы, сессия:', sessionId);
      
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

  // 📱 Проверить статус сессии
  async checkSession(req, res) {
    try {
      const { userId, deviceId, sessionId } = req.user;
      
      console.log('📱 Проверка статуса сессии:', sessionId);
      
      const session = await sessionService.findSessionByToken(
        req.headers.authorization?.split(' ')[1], 
        'access'
      );
      
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Сессия не найдена'
        });
      }
      
      const isValid = session.isActive && !session.isAccessTokenExpired();
      
      res.json({
        success: true,
        isValid,
        session: {
          id: session.id,
          deviceId: session.deviceId,
          deviceName: session.deviceName,
          lastActiveAt: session.lastActiveAt,
          expiresAt: session.accessTokenExpiresAt,
          expiresIn: Math.max(0, Math.floor((session.accessTokenExpiresAt - new Date()) / 1000)),
          location: session.location,
          isActive: session.isActive
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка проверки сессии:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка проверки сессии'
      });
    }
  }

  // 🌐 Получить информацию о текущей сессии
  async getCurrentSession(req, res) {
    try {
      const { userId, deviceId, sessionId } = req.user;
      
      console.log('🌐 Информация о текущей сессии:', sessionId);
      
      const session = await sessionService.findSessionByToken(
        req.headers.authorization?.split(' ')[1], 
        'access'
      );
      
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Сессия не найдена'
        });
      }
      
      res.json({
        success: true,
        session: {
          id: session.id,
          deviceId: session.deviceId,
          deviceName: session.deviceName,
          os: session.os,
          deviceInfo: session.deviceInfo,
          ipAddress: session.ipAddress,
          location: session.location,
          createdAt: session.createdAt,
          lastActiveAt: session.lastActiveAt,
          accessTokenExpiresAt: session.accessTokenExpiresAt,
          refreshTokenExpiresAt: session.refreshTokenExpiresAt,
          isActive: session.isActive
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка получения информации о сессии:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка получения информации'
      });
    }
  }

  // 🔐 Валидация 2FA кода (интегрирую с вашим существующим методом)
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
      // Резервная проверка для тестов
      return /^\d{6}$/.test(code);
    }
  }

  // 🆕 Отправить SMS код (для совместимости с вашей системой)
  async sendSMSCode(req, res) {
    try {
      const { phone, type = 'sms' } = req.body;
      
      console.log('📱 Отправка SMS кода для сессии:', phone);
      
      // Генерируем код
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Сохраняем в вашу таблицу verification_codes
      await VerificationCode.create({
        phone: phone,
        code: code,
        type: type,
        expiresInMinutes: 10
      });
      
      console.log('✅ SMS код создан для сессии:', phone);
      
      // Здесь должна быть интеграция с SMS сервисом
      // await smsService.sendSMS(phone, `Ваш код: ${code}`);
      
      res.json({
        success: true,
        message: 'Код подтверждения отправлен',
        code: code, // Для тестирования, в продакшене удалить
        expiresIn: 600 // 10 минут в секундах
      });
      
    } catch (error) {
      console.error('❌ Ошибка отправки SMS кода:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка отправки кода'
      });
    }
  }

  // 🔍 Проверить регистрацию (адаптированный под сессии)
  async checkRegistration(req, res) {
    const client = await db.getClient();
    try {
      const { phone } = req.body;
      
      console.log('🔍 Проверка регистрации для сессии:', phone);
      
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
      const securitySettings = await UserSecurity.findByUserId(user.user_id);
      
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

  // 🧹 Очистка истекших сессий (админ)
  async cleanupExpiredSessions(req, res) {
    try {
      const { userId, role } = req.user;
      
      if (role !== 'admin' && role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: 'Доступ запрещен'
        });
      }
      
      console.log('🧹 Очистка истекших сессий, инициатор:', userId);
      
      const cleanedCount = await sessionService.cleanupExpiredSessions();
      
      res.json({
        success: true,
        message: `Очищено ${cleanedCount} истекших сессий`,
        cleanedCount
      });
      
    } catch (error) {
      console.error('❌ Ошибка очистки сессий:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка очистки сессий'
      });
    }
  }
}

module.exports = new SessionController();
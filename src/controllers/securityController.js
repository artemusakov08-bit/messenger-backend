const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const User = require('../models/User');
const UserSecurity = require('../models/UserSecurity');
const AuditLog = require('../models/AuditLog');

class SecurityController {
  
  // 🔐 Получить настройки безопасности
  async getSecuritySettings(req, res) {
    try {
      const security = await UserSecurity.findOne({ userId: req.user.id });
      
      if (!security) {
        return res.json({
          twoFAEnabled: false,
          codeWordEnabled: false,
          additionalPasswords: [],
          securityLevel: 'low',
          trustedDevices: []
        });
      }
      
      res.json({
        twoFAEnabled: security.two_fa_enabled,
        codeWordEnabled: security.code_word_enabled,
        codeWordHint: security.code_word_hint,
        additionalPasswords: security.additional_passwords ? JSON.parse(security.additional_passwords) : [],
        securityLevel: security.security_level,
        trustedDevices: security.trusted_devices ? JSON.parse(security.trusted_devices) : [],
        lastSecurityUpdate: security.last_security_update
      });
      
    } catch (error) {
      console.error('Ошибка получения настроек безопасности:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Не удалось получить настройки безопасности' 
      });
    }
  }
  
  // 🔄 Сгенерировать секрет для 2FA
  async generate2FASecret(req, res) {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      
      const secret = speakeasy.generateSecret({
        name: `Messenger (${user.phone})`,
        issuer: 'Messenger'
      });
      
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      
      // Логируем действие
      await AuditLog.create({
        user_id: req.user.id,
        action: 'ГЕНЕРАЦИЯ_2FA_СЕКРЕТА',
        target_type: 'security',
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });
      
      res.json({
        success: true,
        secret: secret.base32,
        qrCode: qrCodeUrl,
        manualEntryKey: secret.base32
      });
      
    } catch (error) {
      console.error('Ошибка генерации 2FA секрета:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Не удалось сгенерировать 2FA секрет' 
      });
    }
  }
  
  // ✅ Включить 2FA
  async enable2FA(req, res) {
    try {
      const { secret, code } = req.body;
      
      if (!secret || !code) {
        return res.status(400).json({ 
          success: false, 
          error: 'Секрет и код обязательны' 
        });
      }
      
      // Проверяем код
      const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: code,
        window: 2
      });
      
      if (!verified) {
        await AuditLog.create({
          user_id: req.user.id,
          action: 'НЕУДАЧНАЯ_АКТИВАЦИЯ_2FA',
          target_type: 'security',
          ip_address: req.ip
        });
        
        return res.status(400).json({ 
          success: false, 
          error: 'Неверный код подтверждения' 
        });
      }
      
      // Находим или создаем настройки безопасности
      const [security, created] = await UserSecurity.findOrCreate(
        { userId: req.user.id },
        { userId: req.user.id }
      );
      
      // Включаем 2FA
      await UserSecurity.update(
        { userId: req.user.id },
        {
          twoFAEnabled: true,
          twoFASecret: secret,
          twoFASetupAt: Date.now(),
          securityLevel: 'high'
        }
      );
      
      // Логируем успешную активацию
      await AuditLog.create({
        user_id: req.user.id,
        action: '2FA_ВКЛЮЧЕНА',
        target_type: 'security',
        ip_address: req.ip
      });
      
      res.json({
        success: true,
        message: '2FA успешно включена'
      });
      
    } catch (error) {
      console.error('Ошибка включения 2FA:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Не удалось включить 2FA' 
      });
    }
  }
  
  // 🗣️ Установить кодовое слово
  async setCodeWord(req, res) {
    try {
      const { codeWord, hint } = req.body;
      
      if (!codeWord || codeWord.length < 4) {
        return res.status(400).json({ 
          success: false, 
          error: 'Кодовое слово должно быть не менее 4 символов' 
        });
      }
      
      await UserSecurity.setCodeWord(req.user.id, codeWord, hint);
      
      // Логируем установку кодового слова
      await AuditLog.create({
        user_id: req.user.id,
        action: 'УСТАНОВКА_КОДОВОГО_СЛОВА',
        target_type: 'security',
        ip_address: req.ip
      });
      
      res.json({
        success: true,
        message: 'Кодовое слово успешно установлено'
      });
      
    } catch (error) {
      console.error('Ошибка установки кодового слова:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Не удалось установить кодовое слово' 
      });
    }
  }
  
  // 🔑 Добавить дополнительный пароль
  async addAdditionalPassword(req, res) {
    try {
      const { password, name } = req.body;
      
      if (!password || password.length < 6) {
        return res.status(400).json({ 
          success: false, 
          error: 'Пароль должен быть не менее 6 символов' 
        });
      }
      
      await UserSecurity.addAdditionalPassword(req.user.id, password, name);
      
      // Логируем добавление пароля
      await AuditLog.create({
        user_id: req.user.id,
        action: 'ДОБАВЛЕНИЕ_ДОПОЛНИТЕЛЬНОГО_ПАРОЛЯ',
        target_type: 'security',
        ip_address: req.ip
      });
      
      res.json({
        success: true,
        message: 'Дополнительный пароль успешно добавлен'
      });
      
    } catch (error) {
      console.error('Ошибка добавления дополнительного пароля:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Не удалось добавить дополнительный пароль' 
      });
    }
  }
  
  // 🛡️ Проверить безопасность для операции
  async verifySecurity(req, res) {
    try {
      const { twoFACode, codeWord, additionalPassword } = req.body;
      const { operation } = req.params;
      
      const security = await UserSecurity.findOne({ userId: req.user.id });
      
      // Если нет настроек безопасности или низкий уровень - пропускаем
      if (!security || security.security_level === 'low') {
        const operationToken = this.generateOperationToken(req.user.id, operation);
        return res.json({
          verified: true,
          operationToken: operationToken
        });
      }
      
      let verified = true;
      const requiredMethods = [];
      
      // Проверяем 2FA если включена
      if (security.two_fa_enabled) {
        if (!twoFACode) {
          verified = false;
          requiredMethods.push('2fa');
        } else {
          const twoFAVerified = speakeasy.totp.verify({
            secret: security.two_fa_secret,
            encoding: 'base32',
            token: twoFACode,
            window: 2
          });
          
          if (!twoFAVerified) {
            verified = false;
          }
        }
      }
      
      if (verified) {
        const operationToken = this.generateOperationToken(req.user.id, operation);
        
        // Логируем успешную проверку
        await AuditLog.create({
          user_id: req.user.id,
          action: `УСПЕШНАЯ_ПРОВЕРКА_БЕЗОПАСНОСТИ: ${operation}`,
          target_type: 'security',
          ip_address: req.ip
        });
        
        res.json({
          verified: true,
          operationToken: operationToken
        });
      } else {
        // Логируем неудачную проверку
        await AuditLog.create({
          user_id: req.user.id,
          action: `НЕУДАЧНАЯ_ПРОВЕРКА_БЕЗОПАСНОСТИ: ${operation}`,
          target_type: 'security',
          ip_address: req.ip
        });
        
        res.status(403).json({
          verified: false,
          requiredMethods: requiredMethods,
          error: 'Требуется проверка безопасности'
        });
      }
      
    } catch (error) {
      console.error('Ошибка проверки безопасности:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Ошибка проверки безопасности' 
      });
    }
  }
  
  // 🔧 Сгенерировать токен операции
  generateOperationToken(userId, operation) {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { 
        userId: userId,
        operation: operation,
        type: 'operation'
      },
      process.env.JWT_SECRET + '_operations',
      { expiresIn: '5m' }
    );
  }
}

module.exports = new SecurityController();
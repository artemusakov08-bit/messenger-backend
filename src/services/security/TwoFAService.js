const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { UserSecurity, VerificationCode } = require('../../models');

class TwoFAService {
  
  // 🔐 Генерация секрета для 2FA
  static async generateSecret(userId, phone) {
    try {
      const secret = speakeasy.generateSecret({
        name: `Messenger (${phone})`,
        issuer: 'Messenger'
      });

      // Генерируем QR-код
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

      return {
        success: true,
        secret: secret.base32,
        qrCode: qrCodeUrl,
        manualEntryKey: secret.base32
      };
    } catch (error) {
      console.error('Ошибка генерации 2FA секрета:', error);
      return {
        success: false,
        error: 'Не удалось сгенерировать 2FA секрет'
      };
    }
  }

  // ✅ Верификация 2FA кода
  static async verifyCode(secret, code) {
    try {
      const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: code,
        window: 2 // Допуск ±1 шаг (60 секунд)
      });

      return {
        success: true,
        verified: verified
      };
    } catch (error) {
      console.error('Ошибка верификации 2FA кода:', error);
      return {
        success: false,
        error: 'Ошибка верификации кода'
      };
    }
  }

  // 🔄 Включение 2FA для пользователя
  static async enable2FA(userId, secret, code) {
    try {
      // Проверяем код
      const verification = await this.verifyCode(secret, code);
      if (!verification.success || !verification.verified) {
        return {
          success: false,
          error: 'Неверный код подтверждения'
        };
      }

      // Находим или создаем настройки безопасности
      const [security, created] = await UserSecurity.findOrCreate({
        where: { userId: userId },
        defaults: { userId: userId }
      });

      // Включаем 2FA
      await security.update({
        twoFAEnabled: true,
        twoFASecret: secret,
        twoFASetupAt: new Date(),
        securityLevel: 'high'
      });

      // Генерируем резервные коды
      const backupCodes = this.generateBackupCodes();

      return {
        success: true,
        backupCodes: backupCodes,
        message: '2FA успешно включена'
      };

    } catch (error) {
      console.error('Ошибка включения 2FA:', error);
      return {
        success: false,
        error: 'Не удалось включить 2FA'
      };
    }
  }

  // 🆘 Генерация резервных кодов
  static generateBackupCodes(count = 10) {
    const codes = [];
    const crypto = require('crypto');

    for (let i = 0; i < count; i++) {
      codes.push(crypto.randomBytes(5).toString('hex').toUpperCase());
    }

    return codes;
  }

  // 🔐 Проверка 2FA для операций
  static async verify2FAForOperation(userId, code, operation) {
    try {
      const security = await UserSecurity.findOne({
        where: { userId: userId }
      });

      if (!security || !security.twoFAEnabled) {
        return {
          success: true,
          verified: true,
          reason: '2FA не включена'
        };
      }

      // Проверяем ограничение попыток
      if (security.twoFALockedUntil && security.twoFALockedUntil > new Date()) {
        return {
          success: false,
          error: '2FA временно заблокирована',
          lockedUntil: security.twoFALockedUntil
        };
      }

      // Проверяем код
      const verification = await this.verifyCode(security.twoFASecret, code);
      if (!verification.verified) {
        // Увеличиваем счетчик попыток
        await security.increment2FAAttempts();
        
        return {
          success: false,
          error: 'Неверный код 2FA',
          attempts: security.twoFAAttempts,
          remainingAttempts: 10 - security.twoFAAttempts
        };
      }

      // Сбрасываем счетчик попыток при успехе
      await security.reset2FAAttempts();
      security.twoFALastUsed = new Date();
      await security.save();

      return {
        success: true,
        verified: true,
        message: '2FA проверка пройдена'
      };

    } catch (error) {
      console.error('Ошибка проверки 2FA для операции:', error);
      return {
        success: false,
        error: 'Ошибка проверки 2FA'
      };
    }
  }
}

module.exports = TwoFAService;
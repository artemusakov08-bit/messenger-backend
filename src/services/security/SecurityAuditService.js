const { AuditLog } = require('../../models');

class SecurityAuditService {
  
  // 📝 Логирование доступа к настройкам безопасности
  static async logSecurityAccess(userId, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: 'ПРОСМОТР_НАСТРОЕК_БЕЗОПАСНОСТИ',
        target_type: 'security_settings',
        ip_address: ipAddress,
        details: {
          type: 'security_access',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования доступа к безопасности:', error);
    }
  }

  // 🔐 Логирование попытки настройки 2FA
  static async log2FASetupAttempt(userId, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: 'ПОПЫТКА_НАСТРОЙКИ_2FA',
        target_type: 'two_factor_auth',
        ip_address: ipAddress,
        details: {
          type: '2fa_setup_attempt',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования настройки 2FA:', error);
    }
  }

  // ✅ Логирование успешного включения 2FA
  static async log2FAEnabled(userId, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: '2FA_ВКЛЮЧЕНА',
        target_type: 'two_factor_auth',
        ip_address: ipAddress,
        details: {
          type: '2fa_enabled',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования включения 2FA:', error);
    }
  }

  // ❌ Логирование неудачной верификации 2FA
  static async log2FAVerificationFailed(userId, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: 'НЕУДАЧНАЯ_ВЕРИФИКАЦИЯ_2FA',
        target_type: 'two_factor_auth',
        ip_address: ipAddress,
        details: {
          type: '2fa_verification_failed',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования неудачной верификации 2FA:', error);
    }
  }

  // 🗣️ Логирование установки кодового слова
  static async logCodeWordSet(userId, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: 'УСТАНОВКА_КОДОВОГО_СЛОВА',
        target_type: 'code_word',
        ip_address: ipAddress,
        details: {
          type: 'code_word_set',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования установки кодового слова:', error);
    }
  }

  // 🔑 Логирование добавления дополнительного пароля
  static async logAdditionalPasswordAdded(userId, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: 'ДОБАВЛЕНИЕ_ДОПОЛНИТЕЛЬНОГО_ПАРОЛЯ',
        target_type: 'additional_password',
        ip_address: ipAddress,
        details: {
          type: 'additional_password_added',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования добавления пароля:', error);
    }
  }

  // ✅ Логирование успешной проверки безопасности
  static async logSecurityVerificationSuccess(userId, operation, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: `УСПЕШНАЯ_ПРОВЕРКА_БЕЗОПАСНОСТИ: ${operation}`,
        target_type: 'security_verification',
        ip_address: ipAddress,
        details: {
          type: 'security_verification_success',
          operation: operation,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования успешной проверки безопасности:', error);
    }
  }

  // ❌ Логирование неудачной проверки безопасности
  static async logSecurityVerificationFailed(userId, operation, ipAddress) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: `НЕУДАЧНАЯ_ПРОВЕРКА_БЕЗОПАСНОСТИ: ${operation}`,
        target_type: 'security_verification',
        ip_address: ipAddress,
        details: {
          type: 'security_verification_failed',
          operation: operation,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования неудачной проверки безопасности:', error);
    }
  }

  // 🚨 Логирование подозрительной активности
  static async logSuspiciousActivity(userId, activityType, ipAddress, details = {}) {
    try {
      await AuditLog.create({
        user_id: userId,
        action: `ПОДОЗРИТЕЛЬНАЯ_АКТИВНОСТЬ: ${activityType}`,
        target_type: 'suspicious_activity',
        ip_address: ipAddress,
        details: {
          type: 'suspicious_activity',
          activity_type: activityType,
          ...details,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Ошибка логирования подозрительной активности:', error);
    }
  }
}

module.exports = SecurityAuditService;
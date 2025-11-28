const crypto = require('crypto');
const bcrypt = require('bcrypt');

class SecurityUtils {
  
  // 🔐 Генерация безопасного случайного токена
  static generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  // 🎲 Генерация случайного кода
  static generateRandomCode(length = 6) {
    const digits = '0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += digits[Math.floor(Math.random() * digits.length)];
    }
    return code;
  }

  // 🔒 Хеширование данных
  static async hashData(data, saltRounds = 12) {
    return await bcrypt.hash(data, saltRounds);
  }

  // 🔍 Сравнение хешей
  static async compareHash(data, hash) {
    return await bcrypt.compare(data, hash);
  }

  // 📧 Валидация email
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // 📞 Валидация номера телефона
  static isValidPhone(phone) {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
  }

  // 🔐 Проверка сложности пароля
  static isStrongPassword(password) {
    if (password.length < 8) return false;
    
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    return hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
  }

  // 🛡️ Проверка IP-адреса на подозрительность
  static isSuspiciousIP(ip) {
    // Проверяем локальные IP-адреса
    const localIPs = [
      '127.0.0.1',
      '10.',
      '192.168.',
      '172.16.',
      '172.17.',
      '172.18.',
      '172.19.',
      '172.20.',
      '172.21.',
      '172.22.',
      '172.23.',
      '172.24.',
      '172.25.',
      '172.26.',
      '172.27.',
      '172.28.',
      '172.29.',
      '172.30.',
      '172.31.'
    ];
    
    return localIPs.some(localIP => ip.startsWith(localIP));
  }

  // ⏰ Расчет времени истечения
  static getExpirationTime(minutes = 10) {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  // 🔄 Форматирование номера телефона
  static formatPhoneNumber(phone) {
    // Убираем все нецифровые символы кроме +
    let cleaned = phone.replace(/[^\d+]/g, '');
    
    // Если номер начинается с 8, заменяем на +7
    if (cleaned.startsWith('8')) {
      cleaned = '+7' + cleaned.slice(1);
    }
    // Если номер без кода страны, добавляем +7
    else if (cleaned.length === 10 && !cleaned.startsWith('+')) {
      cleaned = '+7' + cleaned;
    }
    
    return cleaned;
  }

  // 📱 Генерация информации об устройстве
  static generateDeviceInfo(req) {
    return {
      userAgent: req.get('User-Agent') || 'Unknown',
      ip: req.ip || req.connection.remoteAddress,
      acceptLanguage: req.get('Accept-Language') || 'Unknown',
      platform: this.detectPlatform(req.get('User-Agent') || '')
    };
  }

  // 🖥️ Определение платформы
  static detectPlatform(userAgent) {
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    return 'Unknown';
  }
}

module.exports = SecurityUtils;
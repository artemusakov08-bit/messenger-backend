const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class TokenService {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || this.JWT_SECRET + '_refresh';
  }

  // 🔐 Генерация пары токенов
  generateTokenPair(userId, deviceId, deviceName = 'Unknown Device') {
    // Session Token (30-90 дней)
    const sessionToken = this.generateSessionToken(userId, deviceId);
    
    // Access Token (1 час)
    const accessToken = jwt.sign(
      { 
        userId, 
        deviceId,
        type: 'access',
        sessionId: this.hashToken(sessionToken)
      },
      this.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    // Refresh Token (30 дней)
    const refreshToken = jwt.sign(
      { 
        userId, 
        deviceId,
        type: 'refresh',
        sessionId: this.hashToken(sessionToken)
      },
      this.JWT_REFRESH_SECRET,
      { expiresIn: '30d' }
    );
    
    return {
      sessionToken,
      accessToken,
      refreshToken,
      accessTokenExpiresIn: 3600, // 1 час в секундах
      refreshTokenExpiresIn: 2592000 // 30 дней в секундах
    };
  }

  // 🎫 Генерация session token
  generateSessionToken(userId, deviceId) {
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();
    return `sess_${userId}_${deviceId}_${timestamp}_${randomBytes}`;
  }

  // 🔍 Валидация access token
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      return { valid: true, decoded };
    } catch (error) {
      return { 
        valid: false, 
        error: error.name,
        message: error.message 
      };
    }
  }

  // 🔄 Валидация refresh token
  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_REFRESH_SECRET);
      return { valid: true, decoded };
    } catch (error) {
      return { 
        valid: false, 
        error: error.name,
        message: error.message 
      };
    }
  }

  // 🔒 Хеширование токена для безопасного хранения
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // 📋 Получить данные из токена без валидации
  decodeToken(token) {
    return jwt.decode(token);
  }

  // 🔐 Генерация короткого кода для SMS
  generateSMSCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

module.exports = new TokenService();
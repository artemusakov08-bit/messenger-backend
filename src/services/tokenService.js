const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class TokenService {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || this.JWT_SECRET + '_refresh';
  }

  // 🔐 Генерация пары токенов
  generateTokenPair(userId, deviceId, deviceName = 'Unknown Device') {
    // Session Token (уникальный идентификатор сессии)
    const sessionToken = this.generateSessionToken(userId, deviceId);
    
    // Access Token (1 час)
    const accessToken = jwt.sign(
      { 
        userId, 
        deviceId,
        deviceName,
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
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 2592000
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
      const decoded = jwt.verify(token, this.JWT_SECRET, {
        clockTolerance: 300 
      });
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

  // 🔒 Хеширование токена
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // 📋 Декодирование токена
  decodeToken(token) {
    return jwt.decode(token);
  }

  // 🔐 Генерация SMS кода
  generateSMSCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 🔐 Генерация operation token (для 2FA)
  generateOperationToken(userId, operation, expiresIn = '5m') {
    return jwt.sign(
      { 
        userId, 
        type: 'operation',
        operation,
        iat: Math.floor(Date.now() / 1000)
      },
      this.JWT_SECRET,
      { expiresIn }
    );
  }
}

module.exports = new TokenService();
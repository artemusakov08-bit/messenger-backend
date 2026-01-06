const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTUtils {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || this.JWT_SECRET + '_refresh';
    
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET не установлен в .env файле');
    }
  }

  // 🔐 Генерация токена
  generateToken(userId, expiresIn = '7d') {
    try {
      const token = jwt.sign(
        { 
          userId: userId,
          iat: Math.floor(Date.now() / 1000)
        },
        this.JWT_SECRET,
        { expiresIn: expiresIn }
      );
      
      return token;
    } catch (error) {
      console.error('❌ Error generating token:', error);
      throw new Error('Ошибка генерации токена: ' + error.message);
    }
  }

  // 🔐 Генерация пары токенов
  generateTokenPair(userId, deviceId, deviceName = 'Unknown Device') {
    const sessionToken = this.generateSessionToken(userId, deviceId);
    
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

  // 🔍 Валидация токена
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      return { valid: true, decoded };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return { valid: false, error: 'Токен истек' };
      }
      if (error.name === 'JsonWebTokenError') {
        return { valid: false, error: 'Неверный токен' };
      }
      return { valid: false, error: error.message };
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

  // 📋 Декодирование токена
  decodeToken(token) {
    return jwt.decode(token);
  }

  // 🔒 Хеширование токена
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // 🔑 Генерация SMS кода
  generateSMSCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 🔐 Генерация operation token
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

module.exports = new JWTUtils();
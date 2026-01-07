const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTUtils {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || this.JWT_SECRET + '_refresh';
    this.JWT_SESSION_SECRET = process.env.JWT_SESSION_SECRET || this.JWT_SECRET + '_session';
    
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET не настроен в переменных окружения');
    }
  }

  // 🔐 Генерация пары токенов с сессией
  generateTokenPair(userId, deviceId, deviceName = 'Unknown Device') {
    // Session Token (уникальный идентификатор сессии, не JWT)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    // Access Token (1 час) - содержит sessionId хэш
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
      sessionToken, // Хранится в БД и на клиенте для идентификации сессии
      accessToken,  // Для API запросов
      refreshToken, // Для обновления access токена
      sessionId: this.hashToken(sessionToken), // Хэш для проверки
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 2592000
    };
  }

  // 🔍 Верификация access token
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      
      // Проверяем тип токена
      if (decoded.type !== 'access') {
        return { valid: false, error: 'INVALID_TOKEN_TYPE', message: 'Токен не является access token' };
      }
      
      return { valid: true, decoded };
    } catch (error) {
      return { 
        valid: false, 
        error: error.name,
        message: this.getErrorMessage(error.name)
      };
    }
  }

  // 🔄 Верификация refresh token
  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_REFRESH_SECRET);
      
      if (decoded.type !== 'refresh') {
        return { valid: false, error: 'INVALID_TOKEN_TYPE', message: 'Токен не является refresh token' };
      }
      
      return { valid: true, decoded };
    } catch (error) {
      return { 
        valid: false, 
        error: error.name,
        message: this.getErrorMessage(error.name)
      };
    }
  }

  // 🔒 Хеширование токена
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // 📋 Декодирование токена без проверки
  decodeToken(token) {
    return jwt.decode(token);
  }

  // 🎫 Генерация operation token (для 2FA, регистрации)
  generateOperationToken(payload, expiresIn = '5m') {
    return jwt.sign(
      { 
        ...payload,
        type: 'operation',
        iat: Math.floor(Date.now() / 1000)
      },
      this.JWT_SECRET,
      { expiresIn }
    );
  }

  // ❌ Получение человеко-читаемого сообщения об ошибке
  getErrorMessage(errorCode) {
    const messages = {
      'TokenExpiredError': 'Токен истек',
      'JsonWebTokenError': 'Неверный токен',
      'NotBeforeError': 'Токен еще не активен',
      'INVALID_TOKEN_TYPE': 'Неверный тип токена'
    };
    
    return messages[errorCode] || 'Ошибка проверки токена';
  }

  // 🔍 Проверка session token (хэш сравнение)
  verifySessionToken(sessionToken, expectedHash) {
    const hash = this.hashToken(sessionToken);
    return hash === expectedHash;
  }
}

module.exports = new JWTUtils();
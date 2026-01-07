const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTUtils {
  generateTokenPair(userId, deviceId, deviceName = 'Unknown Device') {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    const accessToken = jwt.sign(
      { 
        userId, 
        deviceId,
        deviceName,
        type: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    const refreshToken = jwt.sign(
      { 
        userId, 
        deviceId,
        type: 'refresh'
      },
      process.env.JWT_SECRET,
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

  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return { valid: true, decoded };
    } catch (error) {
      return { 
        valid: false, 
        error: error.name,
        message: error.message 
      };
    }
  }

  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return { valid: true, decoded };
    } catch (error) {
      return { 
        valid: false, 
        error: error.name,
        message: error.message 
      };
    }
  }

  generateSessionToken(userId, deviceId) {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = new JWTUtils();
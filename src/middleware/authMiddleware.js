const jwt = require('jsonwebtoken');
const db = require('../config/database');
const RolePermissionService = require('../services/auth/RolePermissionService');

class AuthMiddleware {
  async authenticate(req, res, next) {
    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      
      if (!authHeader) {
        return res.status(401).json({ 
          success: false,
          error: 'Требуется авторизация',
          code: 'NO_AUTH_HEADER'
        });
      }
      
      let accessToken;
      if (authHeader.startsWith('Bearer ')) {
        accessToken = authHeader.substring(7);
      } else {
        accessToken = authHeader;
      }
      
      if (!accessToken) {
        return res.status(401).json({ 
          success: false,
          error: 'Токен не предоставлен',
          code: 'NO_TOKEN'
        });
      }
      
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({ 
          success: false,
          error: 'Ошибка конфигурации сервера',
          code: 'JWT_SECRET_MISSING'
        });
      }
      
      let decoded;
      try {
        decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      } catch (jwtError) {
        if (jwtError.name === 'TokenExpiredError') {
          return res.status(401).json({ 
            success: false,
            error: 'Токен истек',
            code: 'TOKEN_EXPIRED',
            requiresRefresh: true
          });
        }
        
        if (jwtError.name === 'JsonWebTokenError') {
          return res.status(401).json({ 
            success: false,
            error: 'Неверный токен',
            code: 'INVALID_TOKEN'
          });
        }
        
        return res.status(401).json({ 
          success: false,
          error: 'Ошибка валидации токена',
          code: 'TOKEN_VALIDATION_ERROR'
        });
      }
      
      const { userId, deviceId } = decoded;
      
      if (!userId || !deviceId) {
        return res.status(401).json({ 
          success: false,
          error: 'Токен не содержит данных',
          code: 'TOKEN_DATA_MISSING'
        });
      }
      
      const client = await db.getClient();
      try {
        const sessionResult = await client.query(
          `SELECT s.*, u.username, u.display_name, u.phone, u.role, u.status, u.auth_level
           FROM sessions s
           JOIN users u ON s.user_id = u.user_id
           WHERE s.user_id = $1 AND s.device_id = $2 AND s.is_active = true`,
          [userId, deviceId]
        );
        
        if (sessionResult.rows.length === 0) {
          return res.status(401).json({ 
            success: false,
            error: 'Сессия не найдена',
            code: 'SESSION_NOT_FOUND',
            sessionExpired: true
          });
        }
        
        const session = sessionResult.rows[0];
        const user = {
          userId: session.user_id,
          username: session.username,
          displayName: session.display_name,
          phone: session.phone,
          role: session.role,
          status: session.status,
          authLevel: session.auth_level
        };
        
        if (session.access_token !== accessToken) {
          return res.status(401).json({ 
            success: false,
            error: 'Токен не соответствует сессии',
            code: 'TOKEN_MISMATCH',
            requiresRefresh: true
          });
        }
        
        const now = new Date();
        const tokenExpiresAt = new Date(session.access_token_expires_at);
        
        if (now > tokenExpiresAt) {
          return res.status(401).json({ 
            success: false,
            error: 'Токен истек',
            code: 'ACCESS_TOKEN_EXPIRED',
            requiresRefresh: true,
            expiresAt: tokenExpiresAt
          });
        }
        
        const refreshExpiresAt = new Date(session.refresh_token_expires_at);
        if (now > refreshExpiresAt) {
          await client.query(
            'UPDATE sessions SET is_active = false WHERE session_id = $1',
            [session.session_id]
          );
          
          return res.status(401).json({ 
            success: false,
            error: 'Сессия истекла',
            code: 'SESSION_EXPIRED',
            sessionExpired: true
          });
        }
        
        await client.query(
          'UPDATE sessions SET last_active_at = NOW() WHERE session_id = $1',
          [session.session_id]
        );
        
        req.user = user;
        req.session = {
          sessionId: session.session_id,
          deviceId: session.device_id,
          deviceName: session.device_name,
          os: session.os,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          accessTokenExpiresAt: session.access_token_expires_at,
          refreshTokenExpiresAt: session.refresh_token_expires_at,
          ipAddress: session.ip_address,
          location: session.location ? JSON.parse(session.location) : null,
          lastActiveAt: session.last_active_at,
          isActive: session.is_active
        };
        
        req.userId = user.userId;
        req.deviceId = deviceId;
        
        next();
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ ОШИБКА АУТЕНТИФИКАЦИИ:', error);
      
      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({ 
          success: false,
          error: 'База данных недоступна',
          code: 'DATABASE_UNAVAILABLE'
        });
      }
      
      res.status(500).json({ 
        success: false,
        error: 'Внутренняя ошибка сервера',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  requireRole(roles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ 
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      if (!Array.isArray(roles)) {
        roles = [roles];
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ 
          success: false,
          error: 'Недостаточно прав',
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredRoles: roles,
          currentRole: req.user.role
        });
      }

      next();
    };
  }

  requirePermission(permission) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ 
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }

      try {
        const hasPermission = await RolePermissionService.hasPermission(req.user.role, permission);
        
        if (!hasPermission) {
          return res.status(403).json({ 
            success: false,
            error: 'Недостаточно прав',
            code: 'INSUFFICIENT_PERMISSIONS',
            requiredPermission: permission,
            currentRole: req.user.role
          });
        }

        next();
      } catch (error) {
        console.error('❌ Ошибка проверки прав:', error);
        res.status(500).json({ 
          success: false,
          error: 'Ошибка проверки прав',
          code: 'PERMISSION_CHECK_ERROR'
        });
      }
    };
  }

  async validateDeviceSession(req, res, next) {
    try {
      if (!req.user || !req.session) {
        return res.status(401).json({ 
          success: false,
          error: 'Требуется аутентификация',
          code: 'AUTH_REQUIRED'
        });
      }
      
      const { userId } = req.user;
      const { deviceId } = req.session;
      
      const client = await db.getClient();
      
      try {
        const sessionCheck = await client.query(
          'SELECT is_active FROM sessions WHERE user_id = $1 AND device_id = $2',
          [userId, deviceId]
        );
        
        if (sessionCheck.rows.length === 0 || !sessionCheck.rows[0].is_active) {
          return res.status(401).json({ 
            success: false,
            error: 'Сессия устройства неактивна',
            code: 'DEVICE_SESSION_INACTIVE',
            sessionTerminated: true
          });
        }
        
        next();
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ Ошибка проверки сессии устройства:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка проверки устройства',
        code: 'DEVICE_VALIDATION_ERROR'
      });
    }
  }
}

module.exports = new AuthMiddleware();
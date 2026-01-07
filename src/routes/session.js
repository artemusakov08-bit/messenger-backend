const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const authMiddleware = require('../middleware/authMiddleware');
const deviceMiddleware = require('../middleware/sessionMiddleware');
const validationMiddleware = require('../middleware/validationMiddleware');

// 🔐 Публичные маршруты (не требуют авторизации)
router.post('/send-code',
  validationMiddleware.validatePhone(),
  sessionController.sendSMSCode
);

router.post('/check-registration',
  validationMiddleware.validatePhone(),
  sessionController.checkRegistration
);

router.post('/login',
  [
    validationMiddleware.validatePhone(),
    validationMiddleware.validateVerificationCode(),
    validationMiddleware.validateDeviceData(),
    validationMiddleware.sanitizeInput()
  ],
  sessionController.login
);

router.post('/refresh',
  [
    validationMiddleware.validateRefreshToken(),
    validationMiddleware.sanitizeInput()
  ],
  sessionController.refresh
);

// 🔐 Защищенные маршруты (требуют авторизации пользователя)
router.get('/check',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  sessionController.checkSession
);

router.get('/current',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  sessionController.getCurrentSession
);

router.get('/all',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  validationMiddleware.validateSessionsQuery(),
  sessionController.getSessions
);

router.delete('/logout',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  sessionController.logout
);

router.delete('/terminate/:sessionId',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  validationMiddleware.validateSessionId(),
  authMiddleware.require2FA, // Для безопасности при удалении конкретной сессии
  sessionController.terminateSession
);

router.delete('/terminate-others',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  deviceMiddleware.canTerminateOtherSessions,
  authMiddleware.require2FA, // Обязательная 2FA для этой операции
  sessionController.terminateAllOtherSessions
);

// 🔄 Альтернативный маршрут для обновления токенов (с дополнительными проверками)
router.post('/refresh-token',
  [
    validationMiddleware.validateRefreshToken(),
    deviceMiddleware.canRefreshToken
  ],
  sessionController.refresh
);

// 📱 Получение информации о текущем устройстве
router.get('/device-info',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  (req, res) => {
    res.json({
      success: true,
      device: {
        deviceId: req.user.deviceId,
        deviceName: req.user.deviceName,
        sessionId: req.user.sessionId,
        ipAddress: req.sessionData?.ipAddress || 'Unknown',
        location: req.sessionData?.location || null,
        lastActiveAt: req.sessionData?.lastActiveAt,
        isActive: true
      }
    });
  }
);

// 🧹 Очистка устаревших сессий пользователя (только своих!)
router.post('/cleanup-expired',
  authMiddleware.authenticate,
  deviceMiddleware.validateDeviceAndSession,
  async (req, res) => {
    try {
      const { userId } = req.user;
      const db = require('../config/database');
      const client = await db.getClient();
      
      try {
        // Удаляем ТОЛЬКО сессии этого пользователя, которые истекли
        const result = await client.query(
          `UPDATE sessions SET is_active = false 
           WHERE user_id = $1 
           AND refresh_token_expires_at < NOW() 
           AND is_active = true 
           RETURNING session_id, device_id`,
          [userId]
        );
        
        const cleanedSessions = result.rows;
        
        // Отправляем уведомления об истечении
        const notificationSocket = require('../sockets/notificationSocket').getNotificationSocket();
        
        for (const session of cleanedSessions) {
          notificationSocket.notifyDevice(userId, session.device_id, {
            type: 'SESSION_EXPIRED_CLEANUP',
            reason: 'AUTO_CLEANUP',
            timestamp: new Date().toISOString(),
            sessionId: session.session_id
          });
        }
        
        res.json({
          success: true,
          message: `Очищено ${cleanedSessions.length} ваших устаревших сессий`,
          cleanedCount: cleanedSessions.length,
          sessions: cleanedSessions.map(s => s.session_id)
        });
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('❌ Ошибка очистки сессий:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка очистки сессий',
        code: 'CLEANUP_ERROR'
      });
    }
  }
);

module.exports = router;
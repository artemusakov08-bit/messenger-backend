const express = require('express');
const router = express.Router();
const securityController = require('../controllers/securityController');
const authMiddleware = require('../middleware/authMiddleware');
const validationMiddleware = require('../middleware/validationMiddleware');

// 🔐 Все роуты требуют аутентификации
router.use(authMiddleware.authenticate);

// 📋 Получить настройки безопасности
router.get('/settings', 
    securityController.getSecuritySettings
);

// 🔄 2FA - Генерация секрета
router.post('/2fa/generate',
    securityController.generate2FASecret
);

// ✅ 2FA - Включение
router.post('/2fa/enable',
    [
        validationMiddleware.validate2FACode(),
        validationMiddleware.sanitizeInput()
    ],
    securityController.enable2FA
);

// 🔴 2FA - Отключение
router.post('/2fa/disable',
    [
        validationMiddleware.validate2FACode(),
        validationMiddleware.sanitizeInput()
    ],
    securityController.disable2FA
);

// 🗣️ Кодовое слово - Установка
router.post('/codeword/set',
    [
        validationMiddleware.validateCodeWord(),
        validationMiddleware.sanitizeInput()
    ],
    securityController.setCodeWord
);

// 🔴 Кодовое слово - Удаление
router.post('/codeword/remove',
    [
        validationMiddleware.validateCodeWord(),
        validationMiddleware.sanitizeInput()
    ],
    securityController.removeCodeWord
);

// 📱 Доверенные устройства - Добавить текущее
router.post('/devices/trust-current',
    securityController.addTrustedDevice
);

// 🗑️ Доверенные устройства - Удалить
router.delete('/devices/trusted/:deviceId',
    [
        validationMiddleware.validate2FACode(),
        validationMiddleware.sanitizeInput()
    ],
    securityController.removeTrustedDevice
);

// 📜 История входов - Получить
router.get('/history/logins',
    [
        validationMiddleware.validateSessionsQuery(),
        validationMiddleware.sanitizeInput()
    ],
    securityController.getLoginHistory
);

// 🧹 История входов - Очистить
router.delete('/history/logins',
    [
        validationMiddleware.validate2FACode(),
        validationMiddleware.sanitizeInput()
    ],
    securityController.clearLoginHistory
);

// 🔐 Проверить безопасность для операции
router.post('/verify/:operation',
    [
        validationMiddleware.sanitizeInput(),
        validationMiddleware.validateDataSize(1)
    ],
    securityController.verifySecurity
);

// 📊 Получить статистику безопасности
router.get('/stats',
    securityController.getSecurityStats
);

// 🛡️ Проверить резервный код 2FA
router.post('/2fa/verify-backup',
    [
        validationMiddleware.sanitizeInput()
    ],
    async (req, res) => {
        try {
            const { userId } = req.user;
            const { backupCode } = req.body;
            
            if (!backupCode) {
                return res.status(400).json({
                    success: false,
                    error: 'Резервный код обязателен',
                    code: 'BACKUP_CODE_REQUIRED'
                });
            }
            
            const isValid = await securityController.verifyBackupCode(userId, backupCode);
            
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Неверный резервный код',
                    code: 'INVALID_BACKUP_CODE'
                });
            }
            
            res.json({
                success: true,
                message: 'Резервный код подтвержден'
            });
            
        } catch (error) {
            console.error('❌ Ошибка проверки резервного кода:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка проверки резервного кода',
                code: 'VERIFY_BACKUP_ERROR'
            });
        }
    }
);

// 🔄 Обновить уровень безопасности
router.post('/update-level',
    [
        validationMiddleware.sanitizeInput()
    ],
    async (req, res) => {
        try {
            const { userId } = req.user;
            const result = await require('../models/UserSecurity').updateSecurityLevel(userId);
            
            res.json({
                success: true,
                ...result
            });
            
        } catch (error) {
            console.error('❌ Ошибка обновления уровня безопасности:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка обновления уровня безопасности',
                code: 'UPDATE_SECURITY_LEVEL_ERROR'
            });
        }
    }
);

module.exports = router;
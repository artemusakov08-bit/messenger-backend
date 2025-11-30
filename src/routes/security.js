const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const SecurityService = require('../services/security/SecurityAuditService');
const TwoFAService = require('../services/security/TwoFAService');

// 🔐 Получить настройки безопасности пользователя
router.get('/settings', auth, (req, res) => {
    const userId = req.user.id;
    
    UserSecurity.findOne({ userId })
        .then(securitySettings => {
            if (!securitySettings) {
                // Создаем дефолтные настройки
                const defaultSettings = new UserSecurity({
                    userId,
                    twoFAEnabled: false,
                    codeWordEnabled: false,
                    codeWordHint: '',
                    trustedDevices: [],
                    securityLevel: 'низкий',
                    securityScore: 25,
                    additionalPasswordsCount: 0,
                    lastUpdated: Date.now()
                });
                return defaultSettings.save();
            }
            return securitySettings;
        })
        .then(settings => {
            res.json({
                success: true,
                data: settings
            });
        })
        .catch(error => {
            console.error('❌ Security settings error:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка получения настроек безопасности'
            });
        });
});

// 🔄 Сгенерировать секрет для 2FA
router.post('/2fa/generate', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const secret = TwoFAService.generateSecret();
        const qrCodeUrl = TwoFAService.generateQRCode(secret, req.user.email);
        
        // Сохраняем временный секрет
        await UserSecurity.findOneAndUpdate(
            { userId },
            { 
                twoFATempSecret: secret,
                twoFATempSecretExpires: Date.now() + 10 * 60 * 1000 // 10 минут
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            data: {
                secret: secret,
                qrCodeUrl: qrCodeUrl,
                backupCodes: TwoFAService.generateBackupCodes()
            }
        });
    } catch (error) {
        console.error('❌ 2FA generate error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка генерации 2FA'
        });
    }
});

// ✅ Включить 2FA
router.post('/2fa/enable', auth, async (req, res) => {
    try {
        const { secret, code } = req.body;
        const userId = req.user.id;

        // Проверяем код
        const isValid = TwoFAService.verifyCode(secret, code);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                error: 'Неверный код подтверждения'
            });
        }

        // Активируем 2FA
        await UserSecurity.findOneAndUpdate(
            { userId },
            { 
                twoFAEnabled: true,
                twoFASecret: secret,
                twoFATempSecret: null,
                twoFATempSecretExpires: null,
                securityLevel: 'высокий',
                securityScore: 75,
                lastUpdated: Date.now()
            },
            { upsert: true, new: true }
        );

        // Логируем действие
        await SecurityService.logSecurityAction(
            userId,
            '2FA_ENABLED',
            'Включена двухфакторная аутентификация'
        );

        res.json({
            success: true,
            data: '2FA успешно включена'
        });
    } catch (error) {
        console.error('❌ 2FA enable error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка включения 2FA'
        });
    }
});

// 🔴 Отключить 2FA
router.delete('/2fa/disable', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        await UserSecurity.findOneAndUpdate(
            { userId },
            { 
                twoFAEnabled: false,
                twoFASecret: null,
                securityLevel: 'средний',
                securityScore: 50,
                lastUpdated: Date.now()
            }
        );

        // Логируем действие
        await SecurityService.logSecurityAction(
            userId,
            '2FA_DISABLED',
            'Отключена двухфакторная аутентификация'
        );

        res.json({
            success: true,
            data: '2FA успешно отключена'
        });
    } catch (error) {
        console.error('❌ 2FA disable error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отключения 2FA'
        });
    }
});

// 🗣️ Установить кодовое слово
router.post('/codeword', auth, async (req, res) => {
    try {
        const { codeWord, hint } = req.body;
        const userId = req.user.id;

        if (!codeWord || codeWord.length < 4) {
            return res.status(400).json({
                success: false,
                error: 'Кодовое слово должно быть не менее 4 символов'
            });
        }

        // Хешируем кодовое слово
        const hashedCodeWord = await SecurityService.hashCodeWord(codeWord);

        await UserSecurity.findOneAndUpdate(
            { userId },
            { 
                codeWordEnabled: true,
                codeWordHash: hashedCodeWord,
                codeWordHint: hint || '',
                securityLevel: 'средний',
                securityScore: 60,
                lastUpdated: Date.now()
            },
            { upsert: true, new: true }
        );

        // Логируем действие
        await SecurityService.logSecurityAction(
            userId,
            'CODE_WORD_SET',
            'Установлено кодовое слово'
        );

        res.json({
            success: true,
            data: 'Кодовое слово успешно установлено'
        });
    } catch (error) {
        console.error('❌ Code word set error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка установки кодового слова'
        });
    }
});

// 🔴 Удалить кодовое слово
router.delete('/codeword', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        await UserSecurity.findOneAndUpdate(
            { userId },
            { 
                codeWordEnabled: false,
                codeWordHash: null,
                codeWordHint: '',
                securityLevel: 'низкий',
                securityScore: 30,
                lastUpdated: Date.now()
            }
        );

        // Логируем действие
        await SecurityService.logSecurityAction(
            userId,
            'CODE_WORD_REMOVED',
            'Удалено кодовое слово'
        );

        res.json({
            success: true,
            data: 'Кодовое слово успешно удалено'
        });
    } catch (error) {
        console.error('❌ Code word remove error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления кодового слова'
        });
    }
});

module.exports = router;
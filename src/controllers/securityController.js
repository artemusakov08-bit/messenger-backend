const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const UserSecurity = require('../models/UserSecurity');
const SessionService = require('../services/sessionService');
const NotificationService = require('../services/NotificationService');
const SecurityUtils = require('../utils/securityUtils');
const db = require('../config/database');

class SecurityController {
    // 🔐 Получить полные настройки безопасности пользователя
    async getSecuritySettings(req, res) {
        try {
            const { userId } = req.user;
            
            // Получаем настройки безопасности
            const security = await UserSecurity.findByUserId(userId);
            
            if (!security) {
                // Создаем дефолтные настройки
                await UserSecurity.createOrUpdate(userId);
                const newSecurity = await UserSecurity.findByUserId(userId);
                
                return res.json({
                    success: true,
                    settings: {
                        twoFA: {
                            enabled: false,
                            setupAt: null,
                            isVerified: false
                        },
                        codeWord: {
                            enabled: false,
                            hasHint: false,
                            hint: '',
                            setupAt: null
                        },
                        trustedDevices: [],
                        loginHistory: [],
                        securityLevel: 'low',
                        securityScore: 50,
                        failedAttempts: 0,
                        isLocked: false,
                        lastSecurityUpdate: new Date().toISOString()
                    }
                });
            }
            
            // Парсим JSON поля
            const trustedDevices = security.trusted_devices ? JSON.parse(security.trusted_devices) : [];
            const loginHistory = security.login_history ? JSON.parse(security.login_history) : [];
            const additionalPasswords = security.additional_passwords ? JSON.parse(security.additional_passwords) : [];
            
            // Проверяем блокировку аккаунта
            const accountLock = await UserSecurity.isAccountLocked(userId);
            
            // Получаем активные сессии
            const activeSessions = await SessionService.getUserSessions(userId, req.user.deviceId);
            
            res.json({
                success: true,
                settings: {
                    twoFA: {
                        enabled: security.two_fa_enabled || false,
                        setupAt: security.two_fa_setup_at,
                        isVerified: !!security.two_fa_secret
                    },
                    codeWord: {
                        enabled: security.code_word_enabled || false,
                        hasHint: !!security.code_word_hint,
                        hint: security.code_word_hint || '',
                        setupAt: security.code_word_set_at
                    },
                    trustedDevices: trustedDevices.map(device => ({
                        deviceId: device.deviceId,
                        deviceName: device.deviceName,
                        os: device.os,
                        addedAt: device.addedAt,
                        lastUsed: device.lastUsed,
                        ipAddress: device.ipAddress,
                        isCurrent: device.deviceId === req.user.deviceId
                    })),
                    loginHistory: loginHistory.slice(0, 20), // Последние 20 входов
                    activeSessions: activeSessions.map(session => ({
                        id: session.id,
                        deviceId: session.deviceId,
                        deviceName: session.deviceName,
                        deviceInfo: session.deviceInfo,
                        os: session.os,
                        ipAddress: session.ipAddress,
                        location: session.location,
                        createdAt: session.createdAt,
                        lastActiveAt: session.lastActiveAt,
                        isCurrent: session.isCurrent,
                        isActive: session.isActive,
                        isOnline: session.isOnline || false
                    })),
                    securityLevel: security.security_level || 'low',
                    securityScore: security.security_score || 50,
                    failedAttempts: security.failed_attempts || 0,
                    isLocked: !!accountLock.locked,
                    lockInfo: accountLock.locked ? {
                        lockedUntil: accountLock.lockedUntil,
                        minutesLeft: accountLock.minutesLeft
                    } : null,
                    lastSecurityUpdate: security.last_security_update
                }
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения настроек безопасности:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка получения настроек безопасности',
                code: 'GET_SECURITY_ERROR'
            });
        }
    }

    // 🔄 Сгенерировать секрет 2FA и QR код
    async generate2FASecret(req, res) {
        try {
            const { userId } = req.user;
            
            // Проверяем, не включена ли уже 2FA
            const security = await UserSecurity.findByUserId(userId);
            if (security?.two_fa_enabled) {
                return res.status(400).json({
                    success: false,
                    error: '2FA уже включена',
                    code: '2FA_ALREADY_ENABLED'
                });
            }
            
            // Генерируем секрет
            const secret = speakeasy.generateSecret({
                name: `Messenger (${userId})`,
                issuer: 'Messenger',
                length: 20
            });
            
            // Генерируем QR код
            const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
            
            // Сохраняем временный секрет в сессии пользователя (не в БД)
            req.session.temp2FASecret = secret.base32;
            req.session.temp2FASecretExpires = Date.now() + 10 * 60 * 1000; // 10 минут
            
            // Генерируем резервные коды
            const backupCodes = Array.from({ length: 8 }, () => 
                SecurityUtils.generateRandomCode(8)
            );
            
            // Сохраняем резервные коды (хешированные)
            const hashedBackupCodes = await Promise.all(
                backupCodes.map(code => SecurityUtils.hashData(code))
            );
            
            req.session.tempBackupCodes = hashedBackupCodes;
            
            res.json({
                success: true,
                data: {
                    secret: secret.base32,
                    qrCode: qrCodeUrl,
                    manualEntryKey: secret.base32,
                    backupCodes: backupCodes, // Отправляем только один раз!
                    expiresIn: 600 // 10 минут в секундах
                },
                warning: 'Сохраните резервные коды в безопасном месте! Они покажутся только один раз.'
            });
            
        } catch (error) {
            console.error('❌ Ошибка генерации 2FA секрета:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка генерации 2FA секрета',
                code: 'GENERATE_2FA_ERROR'
            });
        }
    }

    // ✅ Включить 2FA с проверкой кода
    async enable2FA(req, res) {
        try {
            const { userId } = req.user;
            const { code, backupCode } = req.body;
            
            // Проверяем временный секрет
            if (!req.session.temp2FASecret || !req.session.temp2FASecretExpires) {
                return res.status(400).json({
                    success: false,
                    error: 'Секрет 2FA не сгенерирован или истек',
                    code: '2FA_SECRET_EXPIRED'
                });
            }
            
            if (Date.now() > req.session.temp2FASecretExpires) {
                delete req.session.temp2FASecret;
                delete req.session.temp2FASecretExpires;
                return res.status(400).json({
                    success: false,
                    error: 'Секрет 2FA истек. Сгенерируйте новый.',
                    code: '2FA_SECRET_EXPIRED'
                });
            }
            
            const secret = req.session.temp2FASecret;
            let isValid = false;
            
            // Проверяем основной код
            if (code) {
                isValid = speakeasy.totp.verify({
                    secret: secret,
                    encoding: 'base32',
                    token: code,
                    window: 2
                });
            }
            
            // Если основной код не прошел, проверяем резервный
            if (!isValid && backupCode) {
                const hashedBackupCodes = req.session.tempBackupCodes || [];
                
                // Проверяем каждый резервный код
                for (const hashedCode of hashedBackupCodes) {
                    if (await SecurityUtils.compareHash(backupCode, hashedCode)) {
                        isValid = true;
                        // Помечаем использованный резервный код
                        req.session.usedBackupCode = backupCode;
                        break;
                    }
                }
            }
            
            if (!isValid) {
                await UserSecurity.incrementFailedAttempts(userId);
                
                return res.status(400).json({
                    success: false,
                    error: 'Неверный код подтверждения',
                    code: 'INVALID_2FA_CODE'
                });
            }
            
            // Сбрасываем счетчик неудачных попыток
            await UserSecurity.resetFailedAttempts(userId);
            
            // Включаем 2FA
            await UserSecurity.enable2FA(userId, secret);
            
            // Сохраняем резервные коды в БД
            if (req.session.tempBackupCodes) {
                await this.saveBackupCodes(userId, req.session.tempBackupCodes);
            }
            
            // Очищаем временные данные
            delete req.session.temp2FASecret;
            delete req.session.temp2FASecretExpires;
            delete req.session.tempBackupCodes;
            
            // Отправляем уведомление на все устройства
            const notificationSocket = require('../sockets/notificationSocket').getNotificationSocket();
            notificationSocket.broadcastToUser(userId, {
                type: '2FA_ENABLED',
                title: '2FA включена',
                message: 'Двухфакторная аутентификация успешно включена для вашего аккаунта',
                timestamp: new Date().toISOString()
            });
            
            res.json({
                success: true,
                message: '2FA успешно включена',
                backupCodesReminder: 'Сохраните резервные коды в безопасном месте!'
            });
            
        } catch (error) {
            console.error('❌ Ошибка включения 2FA:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка включения 2FA',
                code: 'ENABLE_2FA_ERROR'
            });
        }
    }

    // 🔴 Отключить 2FA
    async disable2FA(req, res) {
        try {
            const { userId } = req.user;
            const { code } = req.body;
            
            // Проверяем код 2FA
            const security = await UserSecurity.findByUserId(userId);
            if (!security?.two_fa_enabled) {
                return res.status(400).json({
                    success: false,
                    error: '2FA не включена',
                    code: '2FA_NOT_ENABLED'
                });
            }
            
            // Проверяем код
            const isValid = speakeasy.totp.verify({
                secret: security.two_fa_secret,
                encoding: 'base32',
                token: code,
                window: 2
            });
            
            if (!isValid) {
                await UserSecurity.incrementFailedAttempts(userId);
                
                return res.status(400).json({
                    success: false,
                    error: 'Неверный код 2FA',
                    code: 'INVALID_2FA_CODE'
                });
            }
            
            // Отключаем 2FA
            await UserSecurity.disable2FA(userId);
            
            // Удаляем резервные коды
            await this.clearBackupCodes(userId);
            
            // Сбрасываем счетчик неудачных попыток
            await UserSecurity.resetFailedAttempts(userId);
            
            // Отправляем уведомление на все устройства
            const notificationSocket = require('../sockets/notificationSocket').getNotificationSocket();
            notificationSocket.broadcastToUser(userId, {
                type: '2FA_DISABLED',
                title: '2FA отключена',
                message: 'Двухфакторная аутентификация отключена для вашего аккаунта',
                timestamp: new Date().toISOString(),
                securityWarning: 'Уровень безопасности вашего аккаунта снижен'
            });
            
            res.json({
                success: true,
                message: '2FA успешно отключена'
            });
            
        } catch (error) {
            console.error('❌ Ошибка отключения 2FA:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка отключения 2FA',
                code: 'DISABLE_2FA_ERROR'
            });
        }
    }

    // 🗣️ Установить кодовое слово
    async setCodeWord(req, res) {
        try {
            const { userId } = req.user;
            const { codeWord, hint } = req.body;
            
            if (!codeWord || codeWord.length < 4) {
                return res.status(400).json({
                    success: false,
                    error: 'Кодовое слово должно быть не менее 4 символов',
                    code: 'INVALID_CODEWORD_LENGTH'
                });
            }
            
            // Устанавливаем кодовое слово
            await UserSecurity.setCodeWord(userId, codeWord, hint || '');
            
            // Обновляем уровень безопасности
            await UserSecurity.updateSecurityLevel(userId);
            
            res.json({
                success: true,
                message: 'Кодовое слово успешно установлено'
            });
            
        } catch (error) {
            console.error('❌ Ошибка установки кодового слова:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка установки кодового слова',
                code: 'SET_CODEWORD_ERROR'
            });
        }
    }

    // 🔴 Удалить кодовое слово
    async removeCodeWord(req, res) {
        try {
            const { userId } = req.user;
            const { codeWord } = req.body;
            
            // Проверяем кодовое слово
            const isValid = await UserSecurity.verifyCodeWord(userId, codeWord);
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Неверное кодовое слово',
                    code: 'INVALID_CODEWORD'
                });
            }
            
            // Удаляем кодовое слово
            await UserSecurity.removeCodeWord(userId);
            
            // Обновляем уровень безопасности
            await UserSecurity.updateSecurityLevel(userId);
            
            res.json({
                success: true,
                message: 'Кодовое слово успешно удалено'
            });
            
        } catch (error) {
            console.error('❌ Ошибка удаления кодового слова:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка удаления кодового слова',
                code: 'REMOVE_CODEWORD_ERROR'
            });
        }
    }

    // 📱 Добавить устройство в доверенные
    async addTrustedDevice(req, res) {
        try {
            const { userId, deviceId, deviceName } = req.user;
            const { require2FA = true } = req.body;
            
            // Проверяем 2FA если требуется
            if (require2FA) {
                const { twoFACode } = req.body;
                if (!twoFACode) {
                    return res.status(400).json({
                        success: false,
                        error: 'Требуется код 2FA для добавления доверенного устройства',
                        code: '2FA_REQUIRED'
                    });
                }
                
                const security = await UserSecurity.findByUserId(userId);
                if (!security?.two_fa_enabled) {
                    return res.status(400).json({
                        success: false,
                        error: '2FA не включена',
                        code: '2FA_NOT_ENABLED'
                    });
                }
                
                const isValid = speakeasy.totp.verify({
                    secret: security.two_fa_secret,
                    encoding: 'base32',
                    token: twoFACode,
                    window: 2
                });
                
                if (!isValid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Неверный код 2FA',
                        code: 'INVALID_2FA_CODE'
                    });
                }
            }
            
            // Добавляем устройство в доверенные
            await UserSecurity.addTrustedDevice(userId, deviceId, {
                deviceName: deviceName || 'Unknown Device',
                os: req.user.deviceInfo?.os || 'Unknown',
                ipAddress: req.ip
            });
            
            // Обновляем уровень безопасности
            await UserSecurity.updateSecurityLevel(userId);
            
            res.json({
                success: true,
                message: 'Устройство добавлено в доверенные'
            });
            
        } catch (error) {
            console.error('❌ Ошибка добавления доверенного устройства:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка добавления доверенного устройства',
                code: 'ADD_TRUSTED_DEVICE_ERROR'
            });
        }
    }

    // 🗑️ Удалить устройство из доверенных
    async removeTrustedDevice(req, res) {
        try {
            const { userId } = req.user;
            const { deviceId } = req.params;
            
            // Проверяем 2FA для этой операции
            const { twoFACode } = req.body;
            if (!twoFACode) {
                return res.status(400).json({
                    success: false,
                    error: 'Требуется код 2FA для удаления доверенного устройства',
                    code: '2FA_REQUIRED'
                });
            }
            
            const security = await UserSecurity.findByUserId(userId);
            if (!security?.two_fa_enabled) {
                return res.status(400).json({
                    success: false,
                    error: '2FA не включена',
                    code: '2FA_NOT_ENABLED'
                });
            }
            
            const isValid = speakeasy.totp.verify({
                secret: security.two_fa_secret,
                encoding: 'base32',
                token: twoFACode,
                window: 2
            });
            
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Неверный код 2FA',
                    code: 'INVALID_2FA_CODE'
                });
            }
            
            // Удаляем устройство
            await UserSecurity.removeTrustedDevice(userId, deviceId);
            
            // Обновляем уровень безопасности
            await UserSecurity.updateSecurityLevel(userId);
            
            // Завершаем сессию на этом устройстве
            const sessionService = require('../services/sessionService');
            const sessions = await sessionService.getUserSessions(userId);
            const deviceSession = sessions.find(s => s.deviceId === deviceId);
            
            if (deviceSession) {
                await sessionService.terminateSession(deviceSession.id, userId, req.user.deviceId);
            }
            
            res.json({
                success: true,
                message: 'Устройство удалено из доверенных'
            });
            
        } catch (error) {
            console.error('❌ Ошибка удаления доверенного устройства:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка удаления доверенного устройства',
                code: 'REMOVE_TRUSTED_DEVICE_ERROR'
            });
        }
    }

    // 📜 Получить историю входов
    async getLoginHistory(req, res) {
        try {
            const { userId } = req.user;
            const { limit = 20 } = req.query;
            
            const history = await UserSecurity.getLoginHistory(userId, parseInt(limit));
            
            res.json({
                success: true,
                history: history.map(entry => ({
                    timestamp: entry.timestamp,
                    deviceName: entry.deviceName,
                    os: entry.os,
                    ipAddress: entry.ipAddress,
                    location: entry.location,
                    status: entry.status,
                    isCurrent: entry.deviceId === req.user.deviceId
                }))
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения истории входов:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка получения истории входов',
                code: 'GET_LOGIN_HISTORY_ERROR'
            });
        }
    }

    // 🧹 Очистить историю входов
    async clearLoginHistory(req, res) {
        try {
            const { userId } = req.user;
            
            const client = await db.getClient();
            try {
                await client.query(
                    'UPDATE user_security SET login_history = $1 WHERE user_id = $2',
                    [JSON.stringify([]), userId]
                );
            } finally {
                client.release();
            }
            
            res.json({
                success: true,
                message: 'История входов очищена'
            });
            
        } catch (error) {
            console.error('❌ Ошибка очистки истории входов:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка очистки истории входов',
                code: 'CLEAR_LOGIN_HISTORY_ERROR'
            });
        }
    }

    // 🔧 Вспомогательные методы
    
    async saveBackupCodes(userId, hashedCodes) {
        const client = await db.getClient();
        try {
            await client.query(
                'UPDATE user_security SET backup_codes = $1 WHERE user_id = $2',
                [JSON.stringify(hashedCodes), userId]
            );
        } finally {
            client.release();
        }
    }
    
    async clearBackupCodes(userId) {
        const client = await db.getClient();
        try {
            await client.query(
                'UPDATE user_security SET backup_codes = $1 WHERE user_id = $2',
                [JSON.stringify([]), userId]
            );
        } finally {
            client.release();
        }
    }
    
    async verifyBackupCode(userId, code) {
        const client = await db.getClient();
        try {
            const result = await client.query(
                'SELECT backup_codes FROM user_security WHERE user_id = $1',
                [userId]
            );
            
            if (result.rows.length === 0) return false;
            
            const backupCodes = JSON.parse(result.rows[0].backup_codes || '[]');
            
            for (const hashedCode of backupCodes) {
                if (await SecurityUtils.compareHash(code, hashedCode)) {
                    // Удаляем использованный код
                    const updatedCodes = backupCodes.filter(c => c !== hashedCode);
                    await client.query(
                        'UPDATE user_security SET backup_codes = $1 WHERE user_id = $2',
                        [JSON.stringify(updatedCodes), userId]
                    );
                    
                    return true;
                }
            }
            
            return false;
        } finally {
            client.release();
        }
    }
}

module.exports = new SecurityController();
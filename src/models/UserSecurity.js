const db = require('../config/database');
const bcrypt = require('bcrypt');

class UserSecurity {
    // Найти настройки безопасности по userId
    static async findByUserId(userId) {
        try {
            const result = await db.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [userId]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding user security:', error);
            throw error;
        }
    }

    // Создать или обновить настройки безопасности
    static async createOrUpdate(userId, securityData = {}) {
        try {
            const existing = await this.findByUserId(userId);
            
            if (existing) {
                const result = await db.query(
                    `UPDATE user_security SET 
                        two_fa_enabled = COALESCE($1, two_fa_enabled),
                        two_fa_secret = COALESCE($2, two_fa_secret),
                        code_word_enabled = COALESCE($3, code_word_enabled),
                        code_word_hash = COALESCE($4, code_word_hash),
                        code_word_hint = COALESCE($5, code_word_hint),
                        security_level = COALESCE($6, security_level),
                        additional_passwords = COALESCE($7, additional_passwords),
                        trusted_devices = COALESCE($8, trusted_devices),
                        login_history = COALESCE($9, login_history),
                        failed_attempts = COALESCE($10, failed_attempts),
                        last_security_update = $11,
                        security_score = COALESCE($12, security_score)
                     WHERE user_id = $13 RETURNING *`,
                    [
                        securityData.two_fa_enabled || false,
                        securityData.two_fa_secret,
                        securityData.code_word_enabled || false,
                        securityData.code_word_hash,
                        securityData.code_word_hint,
                        securityData.security_level || 'low',
                        securityData.additional_passwords ? JSON.stringify(securityData.additional_passwords) : '[]',
                        securityData.trusted_devices ? JSON.stringify(securityData.trusted_devices) : '[]',
                        securityData.login_history ? JSON.stringify(securityData.login_history) : '[]',
                        securityData.failed_attempts || 0,
                        Date.now(),
                        securityData.security_score || 50,
                        userId
                    ]
                );
                return result.rows[0];
            } else {
                const securityId = 'sec_' + Date.now();
                const result = await db.query(
                    `INSERT INTO user_security (
                        id, user_id, two_fa_enabled, two_fa_secret, 
                        code_word_enabled, code_word_hash, code_word_hint,
                        security_level, additional_passwords, trusted_devices,
                        login_history, failed_attempts, last_security_update, security_score
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
                    [
                        securityId,
                        userId,
                        securityData.two_fa_enabled || false,
                        securityData.two_fa_secret || null,
                        securityData.code_word_enabled || false,
                        securityData.code_word_hash || null,
                        securityData.code_word_hint || '',
                        securityData.security_level || 'low',
                        securityData.additional_passwords ? JSON.stringify(securityData.additional_passwords) : '[]',
                        securityData.trusted_devices ? JSON.stringify(securityData.trusted_devices) : '[]',
                        securityData.login_history ? JSON.stringify(securityData.login_history) : '[]',
                        securityData.failed_attempts || 0,
                        Date.now(),
                        securityData.security_score || 50
                    ]
                );
                return result.rows[0];
            }
        } catch (error) {
            console.error('❌ Error creating/updating user security:', error);
            throw error;
        }
    }

    // Включить 2FA
    static async enable2FA(userId, secret) {
        try {
            const result = await db.query(
                `UPDATE user_security SET 
                    two_fa_enabled = true,
                    two_fa_secret = $1,
                    two_fa_setup_at = $2,
                    security_level = 'high',
                    security_score = 85,
                    last_security_update = $2
                 WHERE user_id = $3 RETURNING *`,
                [secret, Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error enabling 2FA:', error);
            throw error;
        }
    }

    // Отключить 2FA
    static async disable2FA(userId) {
        try {
            const result = await db.query(
                `UPDATE user_security SET 
                    two_fa_enabled = false,
                    two_fa_secret = NULL,
                    two_fa_setup_at = NULL,
                    security_level = 'medium',
                    security_score = 60,
                    last_security_update = $1
                 WHERE user_id = $2 RETURNING *`,
                [Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error disabling 2FA:', error);
            throw error;
        }
    }

    // Установить кодовое слово
    static async setCodeWord(userId, codeWord, hint = '') {
        try {
            const hashedCodeWord = await bcrypt.hash(codeWord, 12);
            const result = await db.query(
                `UPDATE user_security SET 
                    code_word_enabled = true,
                    code_word_hash = $1,
                    code_word_hint = $2,
                    code_word_set_at = $3,
                    security_level = 'medium',
                    security_score = 70,
                    last_security_update = $3
                 WHERE user_id = $4 RETURNING *`,
                [hashedCodeWord, hint, Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error setting code word:', error);
            throw error;
        }
    }

    // Проверить кодовое слово
    static async verifyCodeWord(userId, codeWord) {
        try {
            const security = await this.findByUserId(userId);
            if (!security || !security.code_word_enabled || !security.code_word_hash) {
                return false;
            }
            return await bcrypt.compare(codeWord, security.code_word_hash);
        } catch (error) {
            console.error('❌ Error verifying code word:', error);
            return false;
        }
    }

    // Удалить кодовое слово
    static async removeCodeWord(userId) {
        try {
            const result = await db.query(
                `UPDATE user_security SET 
                    code_word_enabled = false,
                    code_word_hash = NULL,
                    code_word_hint = NULL,
                    code_word_set_at = NULL,
                    security_level = 'low',
                    security_score = 40,
                    last_security_update = $1
                 WHERE user_id = $2 RETURNING *`,
                [Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error removing code word:', error);
            throw error;
        }
    }

    // Добавить доверенное устройство
    static async addTrustedDevice(userId, deviceId, deviceInfo) {
        try {
            const security = await this.findByUserId(userId);
            let trustedDevices = [];
            
            if (security && security.trusted_devices) {
                trustedDevices = JSON.parse(security.trusted_devices);
            }
            
            // Проверяем, не добавлено ли уже это устройство
            const exists = trustedDevices.some(device => device.deviceId === deviceId);
            if (exists) {
                return security;
            }
            
            trustedDevices.push({
                deviceId,
                deviceName: deviceInfo.deviceName || 'Unknown Device',
                os: deviceInfo.os || 'Unknown',
                addedAt: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
                ipAddress: deviceInfo.ipAddress
            });
            
            // Ограничиваем количество доверенных устройств до 10
            if (trustedDevices.length > 10) {
                trustedDevices = trustedDevices.slice(-10);
            }
            
            const result = await db.query(
                `UPDATE user_security SET 
                    trusted_devices = $1,
                    last_security_update = $2
                 WHERE user_id = $3 RETURNING *`,
                [JSON.stringify(trustedDevices), Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error adding trusted device:', error);
            throw error;
        }
    }

    // Удалить доверенное устройство
    static async removeTrustedDevice(userId, deviceId) {
        try {
            const security = await this.findByUserId(userId);
            if (!security || !security.trusted_devices) {
                return null;
            }
            
            let trustedDevices = JSON.parse(security.trusted_devices);
            trustedDevices = trustedDevices.filter(device => device.deviceId !== deviceId);
            
            const result = await db.query(
                `UPDATE user_security SET 
                    trusted_devices = $1,
                    last_security_update = $2
                 WHERE user_id = $3 RETURNING *`,
                [JSON.stringify(trustedDevices), Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error removing trusted device:', error);
            throw error;
        }
    }

    // Проверить, является ли устройство доверенным
    static async isDeviceTrusted(userId, deviceId) {
        try {
            const security = await this.findByUserId(userId);
            if (!security || !security.trusted_devices) {
                return false;
            }
            
            const trustedDevices = JSON.parse(security.trusted_devices);
            return trustedDevices.some(device => device.deviceId === deviceId);
        } catch (error) {
            console.error('❌ Error checking trusted device:', error);
            return false;
        }
    }

    // Обновить время использования доверенного устройства
    static async updateDeviceLastUsed(userId, deviceId) {
        try {
            const security = await this.findByUserId(userId);
            if (!security || !security.trusted_devices) {
                return;
            }
            
            let trustedDevices = JSON.parse(security.trusted_devices);
            trustedDevices = trustedDevices.map(device => {
                if (device.deviceId === deviceId) {
                    return {
                        ...device,
                        lastUsed: new Date().toISOString()
                    };
                }
                return device;
            });
            
            await db.query(
                `UPDATE user_security SET 
                    trusted_devices = $1
                 WHERE user_id = $2`,
                [JSON.stringify(trustedDevices), userId]
            );
        } catch (error) {
            console.error('❌ Error updating device last used:', error);
        }
    }

    // Добавить запись в историю входов
    static async addLoginHistory(userId, loginData) {
        try {
            const security = await this.findByUserId(userId);
            let loginHistory = [];
            
            if (security && security.login_history) {
                loginHistory = JSON.parse(security.login_history);
            }
            
            loginHistory.unshift({
                ...loginData,
                timestamp: new Date().toISOString()
            });
            
            // Ограничиваем историю до 50 записей
            if (loginHistory.length > 50) {
                loginHistory = loginHistory.slice(0, 50);
            }
            
            await db.query(
                `UPDATE user_security SET 
                    login_history = $1,
                    last_security_update = $2
                 WHERE user_id = $3`,
                [JSON.stringify(loginHistory), Date.now(), userId]
            );
        } catch (error) {
            console.error('❌ Error adding login history:', error);
        }
    }

    // Получить историю входов
    static async getLoginHistory(userId, limit = 20) {
        try {
            const security = await this.findByUserId(userId);
            if (!security || !security.login_history) {
                return [];
            }
            
            const loginHistory = JSON.parse(security.login_history);
            return loginHistory.slice(0, limit);
        } catch (error) {
            console.error('❌ Error getting login history:', error);
            return [];
        }
    }

    // Увеличить счетчик неудачных попыток
    static async incrementFailedAttempts(userId) {
        try {
            await db.query(
                `UPDATE user_security SET 
                    failed_attempts = failed_attempts + 1,
                    last_security_update = $1
                 WHERE user_id = $2`,
                [Date.now(), userId]
            );
            
            // Проверяем, не превышен ли лимит
            const security = await this.findByUserId(userId);
            if (security.failed_attempts >= 5) {
                // Блокируем аккаунт на 15 минут
                await db.query(
                    `UPDATE user_security SET 
                        locked_until = $1,
                        last_security_update = $2
                     WHERE user_id = $3`,
                    [new Date(Date.now() + 15 * 60 * 1000), Date.now(), userId]
                );
            }
        } catch (error) {
            console.error('❌ Error incrementing failed attempts:', error);
        }
    }

    // Сбросить счетчик неудачных попыток
    static async resetFailedAttempts(userId) {
        try {
            await db.query(
                `UPDATE user_security SET 
                    failed_attempts = 0,
                    locked_until = NULL,
                    last_security_update = $1
                 WHERE user_id = $2`,
                [Date.now(), userId]
            );
        } catch (error) {
            console.error('❌ Error resetting failed attempts:', error);
        }
    }

    // Проверить, заблокирован ли аккаунт
    static async isAccountLocked(userId) {
        try {
            const security = await this.findByUserId(userId);
            if (!security || !security.locked_until) {
                return false;
            }
            
            const lockedUntil = new Date(security.locked_until);
            const now = new Date();
            
            if (now < lockedUntil) {
                const minutesLeft = Math.ceil((lockedUntil - now) / (1000 * 60));
                return {
                    locked: true,
                    lockedUntil: lockedUntil,
                    minutesLeft: minutesLeft
                };
            }
            
            // Если время блокировки истекло, снимаем блокировку
            if (security.failed_attempts >= 5) {
                await this.resetFailedAttempts(userId);
            }
            
            return false;
        } catch (error) {
            console.error('❌ Error checking account lock:', error);
            return false;
        }
    }

    // Обновить уровень безопасности
    static async updateSecurityLevel(userId) {
        try {
            const security = await this.findByUserId(userId);
            if (!security) return;
            
            let score = 50; // базовый балл
            
            // 2FA добавляет 35 баллов
            if (security.two_fa_enabled) score += 35;
            
            // Кодовое слово добавляет 20 баллов
            if (security.code_word_enabled) score += 20;
            
            // Доверенные устройства добавляют 10 баллов
            if (security.trusted_devices) {
                const trustedDevices = JSON.parse(security.trusted_devices);
                if (trustedDevices.length > 0) score += 10;
            }
            
            // Определяем уровень безопасности
            let securityLevel = 'low';
            if (score >= 80) securityLevel = 'high';
            else if (score >= 60) securityLevel = 'medium';
            
            await db.query(
                `UPDATE user_security SET 
                    security_level = $1,
                    security_score = $2,
                    last_security_update = $3
                 WHERE user_id = $4`,
                [securityLevel, score, Date.now(), userId]
            );
            
            return { securityLevel, securityScore: score };
        } catch (error) {
            console.error('❌ Error updating security level:', error);
            throw error;
        }
    }

    // Получить статистику безопасности
    static async getSecurityStats(userId) {
        try {
            const security = await this.findByUserId(userId);
            if (!security) {
                return {
                    twoFAEnabled: false,
                    codeWordEnabled: false,
                    trustedDevicesCount: 0,
                    securityLevel: 'low',
                    securityScore: 50,
                    lastSecurityUpdate: null
                };
            }
            
            const trustedDevices = security.trusted_devices ? JSON.parse(security.trusted_devices) : [];
            
            return {
                twoFAEnabled: security.two_fa_enabled || false,
                codeWordEnabled: security.code_word_enabled || false,
                trustedDevicesCount: trustedDevices.length,
                securityLevel: security.security_level || 'low',
                securityScore: security.security_score || 50,
                lastSecurityUpdate: security.last_security_update
            };
        } catch (error) {
            console.error('❌ Error getting security stats:', error);
            throw error;
        }
    }
}

module.exports = UserSecurity;
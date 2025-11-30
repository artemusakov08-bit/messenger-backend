// /app/src/models/UserSecurity.js
const db = require('../config/database');

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
                // Обновляем существующие настройки
                const result = await db.query(
                    `UPDATE user_security SET 
                        two_fa_enabled = $1,
                        two_fa_secret = $2,
                        code_word_enabled = $3,
                        code_word_hash = $4,
                        code_word_hint = $5,
                        security_level = $6,
                        last_security_update = $7
                     WHERE user_id = $8 RETURNING *`,
                    [
                        securityData.twoFAEnabled || false,
                        securityData.twoFASecret,
                        securityData.codeWordEnabled || false,
                        securityData.codeWordHash,
                        securityData.codeWordHint,
                        securityData.securityLevel || 'low',
                        Date.now(),
                        userId
                    ]
                );
                return result.rows[0];
            } else {
                // Создаем новые настройки
                const securityId = 'sec_' + Date.now();
                const result = await db.query(
                    `INSERT INTO user_security (
                        id, user_id, two_fa_enabled, two_fa_secret, 
                        code_word_enabled, code_word_hash, code_word_hint,
                        security_level, last_security_update
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                    [
                        securityId,
                        userId,
                        securityData.twoFAEnabled || false,
                        securityData.twoFASecret,
                        securityData.codeWordEnabled || false,
                        securityData.codeWordHash,
                        securityData.codeWordHint,
                        securityData.securityLevel || 'low',
                        Date.now()
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
    static async setCodeWord(userId, codeWordHash, hint) {
        try {
            const result = await db.query(
                `UPDATE user_security SET 
                    code_word_enabled = true,
                    code_word_hash = $1,
                    code_word_hint = $2,
                    code_word_set_at = $3,
                    last_security_update = $3
                 WHERE user_id = $4 RETURNING *`,
                [codeWordHash, hint, Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error setting code word:', error);
            throw error;
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

    // Обновить уровень безопасности
    static async updateSecurityLevel(userId) {
        try {
            const security = await this.findByUserId(userId);
            if (!security) return null;

            let score = 25;
            if (security.two_fa_enabled) score += 30;
            if (security.code_word_enabled) score += 20;
            
            let level = 'низкий';
            if (score >= 80) level = 'максимальный';
            else if (score >= 60) level = 'высокий';
            else if (score >= 40) level = 'средний';

            const result = await db.query(
                `UPDATE user_security SET 
                    security_level = $1,
                    last_security_update = $2
                 WHERE user_id = $3 RETURNING *`,
                [level, Date.now(), userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error updating security level:', error);
            throw error;
        }
    }
}

module.exports = UserSecurity;
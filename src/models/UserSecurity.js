const pool = require('../config/database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class UserSecurity {
    // 🔍 Найти настройки безопасности по userId
    static async findOne(conditions) {
        const client = await pool.connect();
        try {
            const { userId } = conditions;
            const result = await client.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [userId]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // 🔍 Найти или создать настройки безопасности
    static async findOrCreate(conditions) {
    const client = await pool.connect();
    try {
        const { userId } = conditions;
        
        // Пытаемся найти существующую запись
        let result = await client.query(
            'SELECT * FROM user_security WHERE user_id = $1',
            [userId]
        );
        
        if (result.rows[0]) {
            return [result.rows[0], false];
        }
        
        // Создаем новую запись
        const securityId = 'sec_' + Date.now();
        const createResult = await client.query(
            `INSERT INTO user_security (
                id, user_id, two_fa_enabled, two_fa_secret, two_fa_setup_at,
                two_fa_attempts, two_fa_locked_until, code_word_enabled,
                code_word_hash, code_word_hint, code_word_set_at,
                code_word_attempts, code_word_locked_until, additional_passwords,
                security_level, last_security_update, trusted_devices
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING *`,
            [
                securityId, userId,
                false, null, null, 0, null, false,
                null, null, null, 0, null, 
                JSON.stringify([]), 'low', Date.now(), JSON.stringify([])
            ]
        );
        
        return [createResult.rows[0], true];
    } finally {
        client.release();
    }
}

    // ✏️ Обновить настройки безопасности
    static async update(conditions, updates) {
        const client = await pool.connect();
        try {
            const { userId } = conditions;
            
            const setParts = [];
            const values = [];
            let paramCount = 1;
            
            for (const [key, value] of Object.entries(updates)) {
                const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
                
                if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
                    setParts.push(`${dbKey} = $${paramCount}`);
                    values.push(JSON.stringify(value));
                } else {
                    setParts.push(`${dbKey} = $${paramCount}`);
                    values.push(value);
                }
                paramCount++;
            }
            
            if (setParts.length === 0) {
                throw new Error('No fields to update');
            }
            
            values.push(userId);
            
            const query = `
                UPDATE user_security 
                SET ${setParts.join(', ')}, last_security_update = $${paramCount}
                WHERE user_id = $${paramCount + 1}
                RETURNING *
            `;
            values.push(Date.now());
            
            const result = await client.query(query, values);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // 🗣️ Установить кодовое слово
    static async setCodeWord(userId, codeWord, hint = '') {
        const codeWordHash = await bcrypt.hash(codeWord, 12);
        
        return await this.update(
            { userId },
            {
                codeWordEnabled: true,
                codeWordHash: codeWordHash,
                codeWordHint: hint,
                codeWordSetAt: Date.now(),
                codeWordAttempts: 0,
                codeWordLockedUntil: null,
                securityLevel: 'medium'
            }
        );
    }

    // 🔑 Добавить дополнительный пароль
    static async addAdditionalPassword(userId, password, name = 'Дополнительный пароль') {
        const security = await this.findOne({ userId });
        const additionalPasswords = security?.additional_passwords ? JSON.parse(security.additional_passwords) : [];
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const newPassword = {
            id: crypto.randomBytes(8).toString('hex'),
            name: name,
            hash: hashedPassword,
            createdAt: new Date().toISOString(),
            used: false
        };
        
        additionalPasswords.push(newPassword);
        
        return await this.update(
            { userId },
            {
                additionalPasswords: additionalPasswords,
                securityLevel: 'high'
            }
        );
    }
}

module.exports = UserSecurity;
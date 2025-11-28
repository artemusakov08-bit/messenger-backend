const pool = require('../config/database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class UserSecurity {
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

    static async findOrCreate(conditions, defaults) {
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
}

module.exports = UserSecurity;
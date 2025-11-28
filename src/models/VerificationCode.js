const pool = require('../config/database');

class VerificationCode {
    // 🔍 Найти действительный код
    static async findOne(conditions) {
        const client = await pool.connect();
        try {
            const { phone, code, type = 'sms' } = conditions;
            const result = await client.query(
                `SELECT * FROM verification_codes 
                 WHERE phone = $1 AND code = $2 AND type = $3 
                 AND is_used = false AND expires_at > $4`,
                [phone, code, type, new Date()]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // ➕ Создать новый код
    static async create(codeData) {
        const client = await pool.connect();
        try {
            const { phone, code, type = 'sms', expiresInMinutes = 10 } = codeData;

            const codeId = 'code_' + Date.now();
            const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

            const result = await client.query(
                `INSERT INTO verification_codes (
                    id, phone, code, type, attempts, max_attempts, 
                    is_used, expires_at, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *`,
                [codeId, phone, code, type, 0, 3, false, expiresAt, new Date()]
            );

            return result.rows[0];
        } finally {
            client.release();
        }
    }

    // ✏️ Отметить код как использованный
    static async markAsUsed(codeId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'UPDATE verification_codes SET is_used = true WHERE id = $1 RETURNING *',
                [codeId]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // 🗑️ Очистить просроченные коды
    static async cleanExpiredCodes() {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'DELETE FROM verification_codes WHERE expires_at < $1 RETURNING *',
                [new Date()]
            );
            return result.rows;
        } finally {
            client.release();
        }
    }
}

module.exports = VerificationCode;
const pool = require('../config/database');

class VerificationCode {
    // 🔍 Найти действительный код (обновленный)
    static async findValidCode(phone, code, type = 'sms') {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT * FROM verification_codes 
                WHERE phone = $1 AND code = $2 AND type = $3 
                AND is_used = false AND expires_at > NOW()`,
                [phone, code, type]
            );
            
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // 🔍 Найти все коды для телефона
    static async findByPhone(phone, limit = 5) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT * FROM verification_codes 
                WHERE phone = $1 
                ORDER BY created_at DESC 
                LIMIT $2`,
                [phone, limit]
            );
            return result.rows;
        } finally {
            client.release();
        }
    }

    // ➕ Создать новый код (упрощенный)
    static async create({ phone, code, type = 'sms', expiresInMinutes = 10 }) {
        const client = await pool.connect();
        try {
            const codeId = 'code_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

            const result = await client.query(
                `INSERT INTO verification_codes (id, phone, code, type, expires_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 RETURNING *`,
                [codeId, phone, code, type, expiresAt]
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
                'UPDATE verification_codes SET is_used = true, used_at = NOW() WHERE id = $1 RETURNING *',
                [codeId]
            );
            return result.rows[0];
        } finally {
            client.release();
        }
    }

    // 🗑️ Удалить код
    static async delete(codeId) {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM verification_codes WHERE id = $1', [codeId]);
            return true;
        } finally {
            client.release();
        }
    }

    // 🧹 Очистить просроченные коды
    static async cleanExpired() {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'DELETE FROM verification_codes WHERE expires_at < NOW() RETURNING COUNT(*)',
                []
            );
            return parseInt(result.rows[0].count);
        } finally {
            client.release();
        }
    }

    // 📊 Статистика по кодам
    static async getStats(phone) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_used THEN 1 ELSE 0 END) as used,
                    SUM(CASE WHEN expires_at < NOW() THEN 1 ELSE 0 END) as expired
                 FROM verification_codes 
                 WHERE phone = $1`,
                [phone]
            );
            return result.rows[0];
        } finally {
            client.release();
        }
    }
}

module.exports = VerificationCode;
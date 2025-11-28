const pool = require('../config/database');

class User {
    // 🔍 Найти пользователя по ID
    static async findById(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT * FROM users WHERE user_id = $1',
                [userId]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // 🔍 Найти пользователя по условиям
    static async findOne(conditions) {
        const client = await pool.connect();
        try {
            const { phone } = conditions;
            const result = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }
}

module.exports = User;
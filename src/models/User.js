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

    // 🔍 Найти пользователя по телефону (дополнительный метод)
    static async findByPhone(phone) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // 🔄 Обновить статус пользователя
    static async updateStatus(userId, status) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3 RETURNING *',
                [status, new Date(), userId]
            );
            return result.rows[0];
        } finally {
            client.release();
        }
    }

    // 📱 Получить активные устройства пользователя
    static async getActiveDevices(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT DISTINCT device_id, device_name FROM sessions 
                 WHERE user_id = $1 AND is_active = true`,
                [userId]
            );
            return result.rows;
        } finally {
            client.release();
        }
    }

    // 🛡️ Создать запись безопасности (если нет)
    static async createSecurityRecord(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `INSERT INTO user_security (user_id, two_fa_enabled, code_word_enabled, security_level)
                 VALUES ($1, false, false, 'low')
                 ON CONFLICT (user_id) DO NOTHING
                 RETURNING *`,
                [userId]
            );
            return result.rows[0];
        } finally {
            client.release();
        }
    }
}

module.exports = User;
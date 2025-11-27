const pool = require('../config/database'); 

class User {
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

    static async create(userData) {
        const client = await pool.connect();
        try {
            const {
                phone, username, displayName, password = null,
                role = 'user', isPremium = false, isBanned = false,
                banExpires = null, warnings = 0, authLevel = 'sms_only'
            } = userData;

            const userId = 'user_' + Date.now();
            const finalUsername = username || "user_" + Date.now();
            const finalDisplayName = displayName || "User " + phone.slice(-4);

            const result = await client.query(
                `INSERT INTO users (
                    user_id, phone, username, display_name, password, 
                    role, is_premium, is_banned, ban_expires, warnings, auth_level
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
                RETURNING *`,
                [
                    userId, phone, finalUsername, finalDisplayName, password,
                    role, isPremium, isBanned, banExpires, warnings, authLevel
                ]
            );

            return result.rows[0];
        } finally {
            client.release();
        }
    }

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
}

module.exports = User;
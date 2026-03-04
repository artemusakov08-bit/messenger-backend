const db = require('../config/database');

class QRLogin {
    // Создать новую QR-сессию
    static async create(userId = null) {
        const client = await db.getClient();
        try {
            const qrId = 'qr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 минут
            
            // Удаляем старые просроченные QR
            await client.query(
                'DELETE FROM qr_logins WHERE expires_at < NOW()'
            );

            const result = await client.query(
                `INSERT INTO qr_logins (id, user_id, status, expires_at, created_at)
                 VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
                [qrId, userId, userId ? 'confirmed' : 'pending', expiresAt]
            );
            
            return result.rows[0];
        } catch (error) {
            console.error('❌ Error creating QR login:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Найти QR-сессию по ID
    static async findById(qrId) {
        const client = await db.getClient();
        try {
            const result = await client.query(
                'SELECT * FROM qr_logins WHERE id = $1',
                [qrId]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    // Обновить статус QR-сессии
    static async updateStatus(qrId, userId, status) {
        const client = await db.getClient();
        try {
            const result = await client.query(
                `UPDATE qr_logins 
                 SET user_id = $1, status = $2, confirmed_at = NOW() 
                 WHERE id = $3 RETURNING *`,
                [userId, status, qrId]
            );
            return result.rows[0];
        } finally {
            client.release();
        }
    }

    // Очистить просроченные QR
    static async cleanExpired() {
        const client = await db.getClient();
        try {
            const result = await client.query(
                'DELETE FROM qr_logins WHERE expires_at < NOW() RETURNING COUNT(*)'
            );
            return parseInt(result.rows[0].count);
        } finally {
            client.release();
        }
    }
}

module.exports = QRLogin;
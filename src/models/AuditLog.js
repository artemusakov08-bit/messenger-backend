const pool = require('../config/database');

class AuditLog {
    // Создать запись в логе
    static async create(logData) {
        const { userId, action, targetType, targetId, details, ipAddress, userAgent } = logData;
        const id = `log_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        const createdAt = Date.now();

        const result = await pool.query(
            `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [id, userId, action, targetType, targetId, JSON.stringify(details), ipAddress, userAgent, createdAt]
        );

        return result.rows[0];
    }

    // Получить логи пользователя
    static async getByUser(userId, limit = 100) {
        const result = await pool.query(
            `SELECT * FROM audit_logs 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        return result.rows;
    }

    // Получить логи по типу
    static async getByType(targetType, targetId, limit = 50) {
        const result = await pool.query(
            `SELECT * FROM audit_logs 
             WHERE target_type = $1 AND target_id = $2 
             ORDER BY created_at DESC 
             LIMIT $3`,
            [targetType, targetId, limit]
        );
        return result.rows;
    }

    // Получить логи за период
    static async getByPeriod(startTime, endTime = Date.now()) {
        const result = await pool.query(
            `SELECT * FROM audit_logs 
             WHERE created_at BETWEEN $1 AND $2 
             ORDER BY created_at DESC`,
            [startTime, endTime]
        );
        return result.rows;
    }

    // Получить статистику действий
    static async getActionStats(period = 7) {
        const startTime = Date.now() - (period * 24 * 60 * 60 * 1000);

        const result = await pool.query(
            `SELECT 
                action,
                COUNT(*) as count,
                COUNT(DISTINCT user_id) as unique_users
             FROM audit_logs
             WHERE created_at > $1
             GROUP BY action
             ORDER BY count DESC`,
            [startTime]
        );

        return result.rows;
    }
}

module.exports = AuditLog;
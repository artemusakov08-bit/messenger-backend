const pool = require('../config/database');

class AuditLog {
    // 🔍 Найти логи по условиям
    static async findAll(conditions = {}) {
        const client = await pool.connect();
        try {
            let query = 'SELECT * FROM audit_logs';
            const values = [];
            let paramCount = 1;
            const whereConditions = [];

            // Динамически строим WHERE условия
            if (conditions.user_id) {
                whereConditions.push(`user_id = $${paramCount}`);
                values.push(conditions.user_id);
                paramCount++;
            }

            if (conditions.action) {
                whereConditions.push(`action = $${paramCount}`);
                values.push(conditions.action);
                paramCount++;
            }

            if (conditions.start_date) {
                whereConditions.push(`created_at >= $${paramCount}`);
                values.push(conditions.start_date);
                paramCount++;
            }

            if (conditions.end_date) {
                whereConditions.push(`created_at <= $${paramCount}`);
                values.push(conditions.end_date);
                paramCount++;
            }

            if (whereConditions.length > 0) {
                query += ' WHERE ' + whereConditions.join(' AND ');
            }

            query += ' ORDER BY created_at DESC';

            if (conditions.limit) {
                query += ` LIMIT $${paramCount}`;
                values.push(conditions.limit);
            }

            const result = await client.query(query, values);
            return result.rows;
        } finally {
            client.release();
        }
    }

    // ➕ Создать новую запись аудита
    static async create(auditData) {
        const client = await pool.connect();
        try {
            const {
                user_id, action, target_type, target_id, 
                details, ip_address, user_agent
            } = auditData;

            const auditId = 'audit_' + Date.now();
            const createdAt = Date.now();

            const result = await client.query(
                `INSERT INTO audit_logs (
                    id, user_id, action, target_type, target_id, 
                    details, ip_address, user_agent, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *`,
                [
                    auditId, user_id, action, target_type, target_id,
                    JSON.stringify(details || {}), ip_address, user_agent, createdAt
                ]
            );

            return result.rows[0];
        } finally {
            client.release();
        }
    }

    // 📊 Получить статистику аудита
    static async getStats(timeRange = '7d') {
        const client = await pool.connect();
        try {
            let startTime;
            const now = Date.now();

            switch (timeRange) {
                case '24h':
                    startTime = now - (24 * 60 * 60 * 1000);
                    break;
                case '7d':
                    startTime = now - (7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    startTime = now - (30 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    startTime = now - (7 * 24 * 60 * 60 * 1000);
            }

            // Общее количество записей
            const totalResult = await client.query(
                'SELECT COUNT(*) as count FROM audit_logs WHERE created_at > $1',
                [startTime]
            );

            // Записи по типам действий
            const actionsResult = await client.query(
                `SELECT action, COUNT(*) as count 
                 FROM audit_logs 
                 WHERE created_at > $1 
                 GROUP BY action 
                 ORDER BY count DESC 
                 LIMIT 10`,
                [startTime]
            );

            // Активность по пользователям
            const usersResult = await client.query(
                `SELECT user_id, COUNT(*) as count 
                 FROM audit_logs 
                 WHERE created_at > $1 AND user_id IS NOT NULL
                 GROUP BY user_id 
                 ORDER BY count DESC 
                 LIMIT 10`,
                [startTime]
            );

            return {
                total: parseInt(totalResult.rows[0].count),
                topActions: actionsResult.rows,
                topUsers: usersResult.rows,
                timeRange: timeRange
            };
        } finally {
            client.release();
        }
    }
}

module.exports = AuditLog;
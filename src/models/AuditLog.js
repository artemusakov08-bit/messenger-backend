const pool = require('../config/database');

class AuditLog {
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
}

module.exports = AuditLog;
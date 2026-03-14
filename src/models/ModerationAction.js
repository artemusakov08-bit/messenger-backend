const pool = require('../config/database');

class ModerationAction {
    // Создать действие
    static async create(actionData) {
        const { targetUserId, actionType, reason, duration = null, moderatorId = null } = actionData;
        const id = `action_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        const createdAt = Date.now();

        const result = await pool.query(
            `INSERT INTO moderation_actions (id, target_user_id, action_type, reason, duration, moderator_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [id, targetUserId, actionType, reason, duration, moderatorId, createdAt]
        );

        return result.rows[0];
    }

    // Получить действия пользователя
    static async getByUser(userId, limit = 50) {
        const result = await pool.query(
            `SELECT * FROM moderation_actions 
             WHERE target_user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        return result.rows;
    }

    // Получить действия модератора
    static async getByModerator(moderatorId, limit = 50) {
        const result = await pool.query(
            `SELECT * FROM moderation_actions 
             WHERE moderator_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [moderatorId, limit]
        );
        return result.rows;
    }

    // Получить статистику действий
    static async getStats(period = 7) {
        const startTime = Date.now() - (period * 24 * 60 * 60 * 1000);

        const result = await pool.query(
            `SELECT 
                action_type,
                COUNT(*) as count,
                COUNT(DISTINCT target_user_id) as unique_users
             FROM moderation_actions
             WHERE created_at > $1
             GROUP BY action_type`,
            [startTime]
        );

        return result.rows;
    }
}

module.exports = ModerationAction;
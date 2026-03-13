const pool = require('../config/database');

class Group {
    // Создать новую группу
    static async create({ name, description, createdBy, avatarUrl = null }) {
        const client = await pool.connect();
        try {
            const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
            const timestamp = Date.now();

            const result = await client.query(
                `INSERT INTO groups (
                    id, name, description, created_by, avatar_url, 
                    created_at, updated_at, is_private
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [groupId, name, description, createdBy, avatarUrl, timestamp, timestamp, false]
            );

            return result.rows[0];
        } catch (error) {
            console.error('❌ Error creating group:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Найти группу по ID
    static async findById(groupId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT g.*, 
                        COUNT(gm.user_id) as member_count
                 FROM groups g
                 LEFT JOIN group_members gm ON g.id = gm.group_id
                 WHERE g.id = $1
                 GROUP BY g.id`,
                [groupId]
            );

            if (result.rows.length === 0) return null;

            const group = result.rows[0];
            group.member_count = parseInt(group.member_count);
            return group;
        } finally {
            client.release();
        }
    }

    // Получить группы пользователя
    static async getUserGroups(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT g.*, gm.role, gm.joined_at,
                        COUNT(gm2.user_id) as member_count
                 FROM groups g
                 JOIN group_members gm ON g.id = gm.group_id
                 LEFT JOIN group_members gm2 ON g.id = gm2.group_id
                 WHERE gm.user_id = $1
                 GROUP BY g.id, gm.role, gm.joined_at
                 ORDER BY gm.joined_at DESC`,
                [userId]
            );

            return result.rows;
        } finally {
            client.release();
        }
    }

    // Обновить группу
    static async update(groupId, updates) {
        const client = await pool.connect();
        try {
            const { name, description, avatar_url, is_private } = updates;
            const timestamp = Date.now();

            const result = await client.query(
                `UPDATE groups 
                 SET name = COALESCE($1, name),
                     description = COALESCE($2, description),
                     avatar_url = COALESCE($3, avatar_url),
                     is_private = COALESCE($4, is_private),
                     updated_at = $5
                 WHERE id = $6 RETURNING *`,
                [name, description, avatar_url, is_private, timestamp, groupId]
            );

            return result.rows[0];
        } finally {
            client.release();
        }
    }

    // Удалить группу
    static async delete(groupId) {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM groups WHERE id = $1', [groupId]);
            return true;
        } finally {
            client.release();
        }
    }

    // Поиск групп
    static async search(query, userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT g.*, 
                        COUNT(gm.user_id) as member_count
                 FROM groups g
                 LEFT JOIN group_members gm ON g.id = gm.group_id
                 WHERE (g.name ILIKE $1 OR g.description ILIKE $1)
                   AND g.is_private = false
                   AND g.id NOT IN (
                       SELECT group_id FROM group_members WHERE user_id = $2
                   )
                 GROUP BY g.id
                 ORDER BY g.created_at DESC
                 LIMIT 20`,
                [`%${query}%`, userId]
            );

            return result.rows;
        } finally {
            client.release();
        }
    }
}

module.exports = Group;
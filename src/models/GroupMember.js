const pool = require('../config/database');

class GroupMember {
    // Добавить участника
    static async add(groupId, userId, role = 'member') {
        const client = await pool.connect();
        try {
            const timestamp = Date.now();

            const result = await client.query(
                `INSERT INTO group_members (group_id, user_id, role, joined_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (group_id, user_id) DO NOTHING
                 RETURNING *`,
                [groupId, userId, role, timestamp]
            );

            return result.rows[0];
        } catch (error) {
            console.error('❌ Error adding group member:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Удалить участника
    static async remove(groupId, userId) {
        const client = await pool.connect();
        try {
            await client.query(
                'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
                [groupId, userId]
            );
            return true;
        } finally {
            client.release();
        }
    }

    // Получить всех участников группы
    static async getMembers(groupId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT u.user_id, u.username, u.display_name, u.avatar_url, u.status,
                        gm.role, gm.joined_at
                 FROM group_members gm
                 JOIN users u ON gm.user_id = u.user_id
                 WHERE gm.group_id = $1
                 ORDER BY 
                   CASE gm.role 
                     WHEN 'admin' THEN 1
                     WHEN 'moderator' THEN 2
                     ELSE 3 
                   END,
                   gm.joined_at`,
                [groupId]
            );

            return result.rows;
        } finally {
            client.release();
        }
    }

    // Проверить, является ли пользователь админом
    static async isAdmin(groupId, userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
                [groupId, userId]
            );

            return result.rows.length > 0 && result.rows[0].role === 'admin';
        } finally {
            client.release();
        }
    }

    // Проверить, состоит ли пользователь в группе
    static async isMember(groupId, userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
                [groupId, userId]
            );

            return result.rows.length > 0;
        } finally {
            client.release();
        }
    }

    // Обновить роль участника
    static async updateRole(groupId, userId, newRole) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3 RETURNING *',
                [newRole, groupId, userId]
            );

            return result.rows[0];
        } finally {
            client.release();
        }
    }

    // Получить количество участников
    static async getCount(groupId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT COUNT(*) FROM group_members WHERE group_id = $1',
                [groupId]
            );

            return parseInt(result.rows[0].count);
        } finally {
            client.release();
        }
    }
}

module.exports = GroupMember;
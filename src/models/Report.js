const pool = require('../config/database');

class Report {
    static async getPriorityQueue(limit = 50) {
        const result = await pool.query(
            `SELECT r.*, 
                    reporter.display_name as reporter_name,
                    reported.display_name as reported_name
             FROM reports r
             LEFT JOIN users reporter ON r.reporter_id = reporter.user_id
             LEFT JOIN users reported ON r.reported_user_id = reported.user_id
             WHERE r.status = 'pending'
             ORDER BY r.created_at ASC
             LIMIT $1`,
            [limit]
        );
        return result.rows;
    }

    static async findById(id) {
        const result = await pool.query(
            'SELECT * FROM reports WHERE id = $1',
            [id]
        );
        return result.rows[0];
    }

    static async update(id, data) {
        const fields = [];
        const values = [];
        let index = 1;
        
        Object.keys(data).forEach(key => {
            if (key !== 'id' && data[key] !== undefined) {
                fields.push(`${key} = $${index}`);
                values.push(data[key]);
                index++;
            }
        });
        
        if (fields.length === 0) return null;
        
        values.push(id);
        
        const query = `
            UPDATE reports 
            SET ${fields.join(', ')} 
            WHERE id = $${index} 
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        return result.rows[0];
    }

    static async assignToModerator(reportId, moderatorId) {
        const result = await pool.query(
            `UPDATE reports 
             SET status = 'in_progress', assigned_moderator_id = $1 
             WHERE id = $2 RETURNING *`,
            [moderatorId, reportId]
        );
        return result.rows[0];
    }

    static async escalate(reportId) {
        const result = await pool.query(
            `UPDATE reports 
             SET status = 'escalated', escalation_level = escalation_level + 1 
             WHERE id = $1 RETURNING *`,
            [reportId]
        );
        return result.rows[0];
    }
}

module.exports = Report;
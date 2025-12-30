const pool = require('../config/database');

class Report {
  // Создать новую жалобу
  static async create(data) {
    try {
      const reportId = `report_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const timestamp = Date.now();
      
      const query = `
        INSERT INTO reports (
          id, reporter_id, reported_user_id, reported_message_id, 
          reason, priority, status, is_premium, escalation_level, 
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      
      const values = [
        reportId,
        data.reporter_id,
        data.reported_user_id,
        data.reported_message_id || null,
        data.reason,
        data.priority || 'medium',
        data.status || 'pending',
        data.is_premium || false,
        data.escalation_level || 0,
        timestamp
      ];
      
      const result = await pool.query(query, values);
      return result.rows[0];
      
    } catch (error) {
      console.error('❌ Ошибка создания жалобы:', error);
      throw error;
    }
  }
  
  // Найти по ID
  static async findById(id) {
    try {
      const result = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Ошибка поиска жалобы:', error);
      throw error;
    }
  }
  
  // Найти все жалобы
  static async findAll(conditions = {}) {
    try {
      let query = 'SELECT * FROM reports WHERE 1=1';
      const values = [];
      let index = 1;
      
      if (conditions.status) {
        query += ` AND status = $${index}`;
        values.push(conditions.status);
        index++;
      }
      
      if (conditions.priority) {
        query += ` AND priority = $${index}`;
        values.push(conditions.priority);
        index++;
      }
      
      if (conditions.reported_user_id) {
        query += ` AND reported_user_id = $${index}`;
        values.push(conditions.reported_user_id);
        index++;
      }
      
      query += ' ORDER BY created_at DESC';
      
      if (conditions.limit) {
        query += ` LIMIT $${index}`;
        values.push(conditions.limit);
      }
      
      const result = await pool.query(query, values);
      return result.rows;
      
    } catch (error) {
      console.error('❌ Ошибка поиска жалоб:', error);
      throw error;
    }
  }
  
  // Обновить жалобу
  static async update(id, data) {
    try {
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
      
      if (fields.length === 0) {
        return null;
      }
      
      values.push(id);
      
      const query = `
        UPDATE reports 
        SET ${fields.join(', ')} 
        WHERE id = $${index} 
        RETURNING *
      `;
      
      const result = await pool.query(query, values);
      return result.rows[0];
      
    } catch (error) {
      console.error('❌ Ошибка обновления жалобы:', error);
      throw error;
    }
  }
  
  // Удалить жалобу
  static async delete(id) {
    try {
      const result = await pool.query('DELETE FROM reports WHERE id = $1 RETURNING *', [id]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Ошибка удаления жалобы:', error);
      throw error;
    }
  }
  
  // Получить очередь по приоритету
  static async getPriorityQueue(limit = 50) {
    try {
      const query = `
        SELECT r.*, 
               reporter.display_name as reporter_name,
               reported.display_name as reported_name
        FROM reports r
        LEFT JOIN users reporter ON r.reporter_id = reporter.user_id
        LEFT JOIN users reported ON r.reported_user_id = reported.user_id
        WHERE r.status = 'pending'
        ORDER BY 
          r.is_premium DESC,
          CASE r.priority 
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END,
          r.created_at ASC
        LIMIT $1
      `;
      
      const result = await pool.query(query, [limit]);
      return result.rows;
      
    } catch (error) {
      console.error('❌ Ошибка получения очереди:', error);
      throw error;
    }
  }
  
  // Назначить модератора
  static async assignToModerator(reportId, moderatorId) {
    try {
      const query = `
        UPDATE reports 
        SET status = 'in_progress', assigned_moderator_id = $1 
        WHERE id = $2 
        RETURNING *
      `;
      
      const result = await pool.query(query, [moderatorId, reportId]);
      return result.rows[0];
      
    } catch (error) {
      console.error('❌ Ошибка назначения модератора:', error);
      throw error;
    }
  }
  
  // Эскалировать жалобу
  static async escalate(reportId) {
    try {
      const query = `
        UPDATE reports 
        SET 
          status = 'escalated',
          escalation_level = escalation_level + 1
        WHERE id = $1 
        RETURNING *
      `;
      
      const result = await pool.query(query, [reportId]);
      return result.rows[0];
      
    } catch (error) {
      console.error('❌ Ошибка эскалации жалобы:', error);
      throw error;
    }
  }
  
  // Решить жалобу
  static async resolve(reportId, resolution, moderatorId = null) {
    try {
      const query = `
        UPDATE reports 
        SET 
          status = 'resolved',
          resolution = $1,
          resolved_at = $2,
          assigned_moderator_id = COALESCE($3, assigned_moderator_id)
        WHERE id = $4 
        RETURNING *
      `;
      
      const result = await pool.query(query, [resolution, Date.now(), moderatorId, reportId]);
      return result.rows[0];
      
    } catch (error) {
      console.error('❌ Ошибка решения жалобы:', error);
      throw error;
    }
  }
  
  // Статистика
  static async getStats(periodDays = 7) {
    try {
      const startTime = Date.now() - (periodDays * 24 * 60 * 60 * 1000);
      
      const [total, pending, resolved, avgTime] = await Promise.all([
        // Всего жалоб
        pool.query('SELECT COUNT(*) FROM reports WHERE created_at > $1', [startTime]),
        // Ожидающие
        pool.query('SELECT COUNT(*) FROM reports WHERE status = $1 AND created_at > $1', ['pending', startTime]),
        // Решенные
        pool.query('SELECT COUNT(*) FROM reports WHERE status = $1 AND created_at > $1', ['resolved', startTime]),
        // Среднее время решения
        pool.query(`
          SELECT AVG(resolved_at - created_at) as avg_resolution_time 
          FROM reports 
          WHERE status = 'resolved' AND resolved_at IS NOT NULL AND created_at > $1
        `, [startTime])
      ]);
      
      return {
        total: parseInt(total.rows[0].count),
        pending: parseInt(pending.rows[0].count),
        resolved: parseInt(resolved.rows[0].count),
        resolution_rate: total.rows[0].count > 0 ? 
          ((parseInt(resolved.rows[0].count) / parseInt(total.rows[0].count)) * 100).toFixed(1) : 0,
        avg_resolution_time: avgTime.rows[0].avg_resolution_time ? 
          Math.round(avgTime.rows[0].avg_resolution_time / 60000) : 0 // в минутах
      };
      
    } catch (error) {
      console.error('❌ Ошибка получения статистики:', error);
      throw error;
    }
  }
}

module.exports = Report;
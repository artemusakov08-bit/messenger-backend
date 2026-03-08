const pool = require('../config/database');

class Reaction {
  // Добавить реакцию
  static async add(messageId, userId, emoji) {
    const client = await pool.connect();
    try {
      const id = `reaction_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const timestamp = Date.now();
      
      const result = await client.query(
        `INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING
         RETURNING *`,
        [id, messageId, userId, emoji, timestamp]
      );
      
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Удалить реакцию
  static async remove(messageId, userId, emoji) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING *',
        [messageId, userId, emoji]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Получить все реакции для сообщения
  static async getForMessage(messageId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT emoji, json_agg(json_build_object('userId', user_id, 'createdAt', created_at)) as users
         FROM message_reactions
         WHERE message_id = $1
         GROUP BY emoji`,
        [messageId]
      );
      
      const reactions = {};
      result.rows.forEach(row => {
        reactions[row.emoji] = row.users;
      });
      
      return reactions;
    } finally {
      client.release();
    }
  }

  // Удалить все реакции сообщения
  static async deleteForMessage(messageId) {
    const client = await pool.connect();
    try {
      await client.query(
        'DELETE FROM message_reactions WHERE message_id = $1',
        [messageId]
      );
    } finally {
      client.release();
    }
  }
}

module.exports = Reaction;
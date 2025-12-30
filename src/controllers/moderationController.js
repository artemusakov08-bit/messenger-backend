const Report = require('../models/Report');
const pool = require('../config/database');

class ModerationController {
  // Получить очередь жалоб
  async getReportQueue(req, res) {
    try {
      const { limit = 50 } = req.query;
      const queue = await Report.getPriorityQueue(parseInt(limit));
      
      console.log(`📋 Получено жалоб: ${queue.length}`);
      
      res.json({
        success: true,
        count: queue.length,
        queue
      });
      
    } catch (error) {
      console.error('❌ Ошибка получения очереди:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера' 
      });
    }
  }
  
  // Назначить жалобу модератору
  async assignReport(req, res) {
    try {
      const { reportId } = req.params;
      const moderatorId = req.user?.userId || req.user?.id;
      
      if (!moderatorId) {
        return res.status(401).json({
          success: false,
          error: 'Требуется аутентификация'
        });
      }
      
      console.log(`👮 Назначение жалобы ${reportId} модератору ${moderatorId}`);
      
      const report = await Report.assignToModerator(reportId, moderatorId);
      
      if (!report) {
        return res.status(404).json({
          success: false,
          error: 'Жалоба не найдена'
        });
      }
      
      res.json({
        success: true,
        message: 'Жалоба назначена модератору',
        report
      });
      
    } catch (error) {
      console.error('❌ Ошибка назначения жалобы:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Решить жалобу
  async resolveReport(req, res) {
    try {
      const { reportId } = req.params;
      const { resolution, action, banDuration } = req.body;
      const moderatorId = req.user?.userId || req.user?.id;
      
      if (!resolution) {
        return res.status(400).json({
          success: false,
          error: 'Требуется описание решения'
        });
      }
      
      console.log(`✅ Решение жалобы ${reportId}: ${action || 'разрешено'}`);
      
      const report = await Report.resolve(reportId, resolution, moderatorId);
      
      if (!report) {
        return res.status(404).json({
          success: false,
          error: 'Жалоба не найдена'
        });
      }
      
      // Применяем дополнительные действия
      if (action === 'ban_user' && report.reported_user_id) {
        await this.banUser(report.reported_user_id, banDuration);
      }
      
      res.json({
        success: true,
        message: 'Жалоба разрешена',
        report
      });
      
    } catch (error) {
      console.error('❌ Ошибка решения жалобы:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Эскалировать жалобу
  async escalateReport(req, res) {
    try {
      const { reportId } = req.params;
      const { reason } = req.body;
      
      console.log(`⚠️ Эскалация жалобы ${reportId}: ${reason || 'без указания причины'}`);
      
      const report = await Report.escalate(reportId);
      
      if (!report) {
        return res.status(404).json({
          success: false,
          error: 'Жалоба не найдена'
        });
      }
      
      res.json({
        success: true,
        message: 'Жалоба эскалирована',
        report,
        reason: reason || 'Причина не указана'
      });
      
    } catch (error) {
      console.error('❌ Ошибка эскалации жалобы:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Автоматическая модерация контента
  async scanContent(req, res) {
    try {
      const { content } = req.body;
      
      if (!content) {
        return res.status(400).json({
          success: false,
          error: 'Требуется контент для проверки'
        });
      }
      
      console.log(`🔍 Сканирование контента: ${content.substring(0, 100)}...`);
      
      const violations = this.autoModerateContent(content);
      const shouldReview = violations.length > 0;
      
      res.json({
        success: true,
        violations,
        shouldReview,
        message: shouldReview ? 'Обнаружены нарушения' : 'Контент чист'
      });
      
    } catch (error) {
      console.error('❌ Ошибка сканирования контента:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Получить статистику
  async getStats(req, res) {
    try {
      const { period = 7 } = req.query;
      
      const stats = await Report.getStats(parseInt(period));
      
      res.json({
        success: true,
        period: `${period} дней`,
        stats
      });
      
    } catch (error) {
      console.error('❌ Ошибка получения статистики:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Создать новую жалобу
  async createReport(req, res) {
    try {
      const { reported_user_id, reported_message_id, reason } = req.body;
      const reporter_id = req.user?.userId || req.user?.id;
      
      if (!reported_user_id || !reason) {
        return res.status(400).json({
          success: false,
          error: 'Требуется reported_user_id и reason'
        });
      }
      
      console.log(`🆘 Новая жалоба от ${reporter_id} на ${reported_user_id}: ${reason}`);
      
      // Проверяем премиум статус репортера
      const reporterResult = await pool.query(
        'SELECT is_premium FROM users WHERE user_id = $1',
        [reporter_id]
      );
      
      const is_premium = reporterResult.rows[0]?.is_premium || false;
      
      // Определяем приоритет
      let priority = 'medium';
      if (is_premium) priority = 'high';
      
      // Критические ключевые слова
      const criticalWords = ['спам', 'мошенничество', 'угрозы', 'взлом', 'обман', 'скам'];
      if (criticalWords.some(word => reason.toLowerCase().includes(word))) {
        priority = 'critical';
      }
      
      const reportData = {
        reporter_id,
        reported_user_id,
        reported_message_id,
        reason,
        priority,
        is_premium
      };
      
      const report = await Report.create(reportData);
      
      res.status(201).json({
        success: true,
        message: 'Жалоба создана',
        report
      });
      
    } catch (error) {
      console.error('❌ Ошибка создания жалобы:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Получить жалобу по ID
  async getReportById(req, res) {
    try {
      const { reportId } = req.params;
      
      const report = await Report.findById(reportId);
      
      if (!report) {
        return res.status(404).json({
          success: false,
          error: 'Жалоба не найдена'
        });
      }
      
      // Получаем дополнительную информацию
      const [reporter, reported] = await Promise.all([
        pool.query('SELECT user_id, display_name, username FROM users WHERE user_id = $1', [report.reporter_id]),
        pool.query('SELECT user_id, display_name, username FROM users WHERE user_id = $1', [report.reported_user_id])
      ]);
      
      const reportWithDetails = {
        ...report,
        reporter: reporter.rows[0] || null,
        reported_user: reported.rows[0] || null
      };
      
      res.json({
        success: true,
        report: reportWithDetails
      });
      
    } catch (error) {
      console.error('❌ Ошибка получения жалобы:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Получить все жалобы
  async getAllReports(req, res) {
    try {
      const { status, priority, user_id, limit = 100 } = req.query;
      
      const conditions = {};
      if (status) conditions.status = status;
      if (priority) conditions.priority = priority;
      if (user_id) conditions.reported_user_id = user_id;
      if (limit) conditions.limit = parseInt(limit);
      
      const reports = await Report.findAll(conditions);
      
      res.json({
        success: true,
        count: reports.length,
        reports
      });
      
    } catch (error) {
      console.error('❌ Ошибка получения жалоб:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
  
  // Вспомогательные методы
  
  // Автоматическая модерация контента
  autoModerateContent(text) {
    const violations = [];
    
    if (!text || typeof text !== 'string') {
      return violations;
    }
    
    const lowercaseText = text.toLowerCase();
    
    // Запрещенные слова
    const bannedWords = [
      'спам', 'скам', 'мошенничество', 'обман',
      'взлом', 'хакинг', 'кряк', 'взломать',
      'угрозы', 'угрожать', 'убить', 'избить',
      'наркотики', 'наркота', 'трава', 'героин'
    ];
    
    const foundBannedWords = bannedWords.filter(word => 
      lowercaseText.includes(word)
    );
    
    if (foundBannedWords.length > 0) {
      violations.push({
        type: 'banned_words',
        words: foundBannedWords,
        severity: 'high'
      });
    }
    
    // Проверка на спам (повторяющиеся символы)
    const repeatedChars = /(.)\1{5,}/;
    if (repeatedChars.test(text)) {
      violations.push({
        type: 'spam',
        severity: 'medium'
      });
    }
    
    // Проверка на CAPS LOCK
    const capsChars = text.match(/[A-ZА-Я]/g) || [];
    const totalChars = text.length;
    
    if (totalChars > 10 && capsChars.length / totalChars > 0.7) {
      violations.push({
        type: 'excessive_caps',
        severity: 'low'
      });
    }
    
    // Проверка на ссылки
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);
    
    if (urls && urls.length > 3) {
      violations.push({
        type: 'excessive_links',
        count: urls.length,
        severity: 'medium'
      });
    }
    
    return violations;
  }
  
  // Блокировка пользователя
  async banUser(userId, durationHours = 24) {
    try {
      const banExpires = Date.now() + (durationHours * 60 * 60 * 1000);
      
      await pool.query(
        `UPDATE users 
         SET is_banned = true, ban_expires = $1, warnings = COALESCE(warnings, 0) + 1 
         WHERE user_id = $2`,
        [banExpires, userId]
      );
      
      console.log(`🔒 Пользователь ${userId} заблокирован на ${durationHours} часов`);
      
      // Записываем действие в лог
      await pool.query(
        `INSERT INTO moderation_actions (id, target_user_id, action_type, reason, duration, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`action_${Date.now()}`, userId, 'ban', 'Нарушение правил', durationHours * 60 * 60 * 1000, Date.now()]
      );
      
      return true;
      
    } catch (error) {
      console.error('❌ Ошибка блокировки пользователя:', error);
      return false;
    }
  }
}

module.exports = new ModerationController();
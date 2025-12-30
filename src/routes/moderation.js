const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../config/database'); // ДОБАВЬТЕ ЭТУ СТРОКУ!

// 🔥 Проверка ролей модератора
const requireModerator = (req, res, next) => {
  const userRole = req.user?.role;
  
  if (!userRole || !['moderator', 'admin', 'lead', 'super_admin'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Недостаточно прав. Требуется роль модератора или выше'
    });
  }
  
  next();
};

// 🔥 Проверка администратора
const requireAdmin = (req, res, next) => {
  const userRole = req.user?.role;
  
  if (!userRole || !['admin', 'lead', 'super_admin'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Недостаточно прав. Требуется роль администратора или выше'
    });
  }
  
  next();
};

// Все роуты требуют аутентификации
router.use(authMiddleware.authenticate);

// ==================== 📋 ОЧЕРЕДЬ И СТАТИСТИКА ====================

// Очередь жалоб (только для модераторов)
router.get('/queue', 
  requireModerator,
  moderationController.getReportQueue
);

// Статистика модерации
router.get('/stats',
  requireModerator,
  moderationController.getStats
);

// ==================== 📨 УПРАВЛЕНИЕ ЖАЛОБАМИ ====================

// Создать новую жалобу (доступно всем авторизованным)
router.post('/reports',
  moderationController.createReport
);

// Получить все жалобы (для модераторов)
router.get('/reports',
  requireModerator,
  moderationController.getAllReports
);

// Получить жалобу по ID
router.get('/reports/:reportId',
  requireModerator,
  moderationController.getReportById
);

// Назначить жалобу модератору
router.patch('/reports/:reportId/assign',
  requireModerator,
  moderationController.assignReport
);

// Решить жалобу
router.patch('/reports/:reportId/resolve',
  requireModerator,
  moderationController.resolveReport
);

// Эскалировать жалобу
router.patch('/reports/:reportId/escalate',
  requireAdmin, // Только админы могут эскалировать
  moderationController.escalateReport
);

// ==================== 🤖 АВТОМОДЕРАЦИЯ ====================

// Проверка контента
router.post('/scan-content',
  requireModerator,
  moderationController.scanContent
);

// ==================== 📊 ДОПОЛНИТЕЛЬНЫЕ ЭНДПОИНТЫ ====================

// Поиск жалоб по пользователю
router.get('/user/:userId/reports',
  requireModerator,
  async (req, res) => {
    // Перенаправляем в основной контроллер
    req.query.user_id = req.params.userId;
    return moderationController.getAllReports(req, res);
  }
);

// Получить мои назначенные жалобы
router.get('/my-assigned',
  requireModerator,
  async (req, res) => {
    try {
      const moderatorId = req.user?.userId;
      
      const query = `
        SELECT * FROM reports 
        WHERE assigned_moderator_id = $1 AND status = 'in_progress'
        ORDER BY created_at DESC
      `;
      
      const result = await pool.query(query, [moderatorId]);
      
      res.json({
        success: true,
        count: result.rows.length,
        reports: result.rows
      });
      
    } catch (error) {
      console.error('❌ Ошибка получения назначенных жалоб:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка сервера'
      });
    }
  }
);

// Health check для модерации
router.get('/health',
  (req, res) => {
    res.json({
      success: true,
      service: 'moderation',
      status: 'operational',
      timestamp: new Date().toISOString()
    });
  }
);

module.exports = router; 
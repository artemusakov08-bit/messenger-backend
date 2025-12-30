const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../config/database');

// Проверка ролей
const requireModerator = (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !['moderator', 'admin', 'lead', 'super_admin'].includes(userRole)) {
        return res.status(403).json({ 
            success: false,
            error: 'Недостаточно прав. Требуется роль модератора' 
        });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !['admin', 'lead', 'super_admin'].includes(userRole)) {
        return res.status(403).json({ 
            success: false,
            error: 'Недостаточно прав. Требуется роль администратора' 
        });
    }
    next();
};

// ==================== 📋 ОСНОВНЫЕ ЭНДПОИНТЫ МОДЕРАЦИИ ====================

// 1. Очередь жалоб (сортировка по приоритету)
router.get('/queue', 
    authMiddleware.authenticate,
    requireModerator,
    moderationController.getReportQueue
);

// 2. Статистика модерации
router.get('/stats',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { period = 7 } = req.query;
            const startTime = Date.now() - (period * 24 * 60 * 60 * 1000);
            
            const [total, pending, resolved, avgTime] = await Promise.all([
                pool.query('SELECT COUNT(*) FROM reports WHERE created_at > $1', [startTime]),
                pool.query('SELECT COUNT(*) FROM reports WHERE status = $1 AND created_at > $1', ['pending', startTime]),
                pool.query('SELECT COUNT(*) FROM reports WHERE status = $1 AND created_at > $1', ['resolved', startTime]),
                pool.query(`
                    SELECT AVG(resolved_at - created_at) as avg_time 
                    FROM reports 
                    WHERE status = 'resolved' AND resolved_at IS NOT NULL
                `)
            ]);
            
            res.json({
                success: true,
                stats: {
                    total: parseInt(total.rows[0].count),
                    pending: parseInt(pending.rows[0].count),
                    resolved: parseInt(resolved.rows[0].count),
                    resolutionRate: total.rows[0].count > 0 
                        ? ((parseInt(resolved.rows[0].count) / parseInt(total.rows[0].count)) * 100).toFixed(1)
                        : 0,
                    avgResolutionTime: avgTime.rows[0].avg_time 
                        ? Math.round(avgTime.rows[0].avg_time / 60000)
                        : 0
                }
            });
        } catch (error) {
            console.error('❌ Ошибка статистики:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// ==================== 📨 УПРАВЛЕНИЕ ЖАЛОБАМИ ====================

// 3. Создать жалобу (доступно всем авторизованным)
router.post('/reports',
    authMiddleware.authenticate,
    async (req, res) => {
        try {
            const { reported_user_id, reported_message_id, reason } = req.body;
            const reporter_id = req.user.userId;
            
            if (!reported_user_id || !reason) {
                return res.status(400).json({
                    success: false,
                    error: 'Требуется reported_user_id и reason'
                });
            }
            
            console.log(`🆘 Новая жалоба от ${reporter_id} на ${reported_user_id}`);
            
            // Проверяем премиум статус
            const reporterResult = await pool.query(
                'SELECT is_premium FROM users WHERE user_id = $1',
                [reporter_id]
            );
            
            const is_premium = reporterResult.rows[0]?.is_premium || false;
            
            // Определяем приоритет
            let priority = 'medium';
            if (is_premium) priority = 'high';
            
            const criticalWords = ['спам', 'мошенничество', 'угрозы', 'взлом'];
            if (criticalWords.some(word => reason.toLowerCase().includes(word))) {
                priority = 'critical';
            }
            
            const reportId = `report_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
            
            const result = await pool.query(
                `INSERT INTO reports (id, reporter_id, reported_user_id, reported_message_id, reason, priority, status, is_premium, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [reportId, reporter_id, reported_user_id, reported_message_id || null, reason, 
                 priority, 'pending', is_premium, Date.now()]
            );
            
            res.status(201).json({
                success: true,
                message: 'Жалоба создана',
                report: result.rows[0]
            });
            
        } catch (error) {
            console.error('❌ Ошибка создания жалобы:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 4. Получить все жалобы (фильтрация)
router.get('/reports',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { status, priority, user_id, limit = 100 } = req.query;
            
            let query = 'SELECT * FROM reports WHERE 1=1';
            const values = [];
            let index = 1;
            
            if (status) {
                query += ` AND status = $${index}`;
                values.push(status);
                index++;
            }
            
            if (priority) {
                query += ` AND priority = $${index}`;
                values.push(priority);
                index++;
            }
            
            if (user_id) {
                query += ` AND (reporter_id = $${index} OR reported_user_id = $${index})`;
                values.push(user_id);
                index++;
            }
            
            query += ' ORDER BY created_at DESC';
            
            if (limit) {
                query += ` LIMIT $${index}`;
                values.push(parseInt(limit));
            }
            
            const result = await pool.query(query, values);
            
            res.json({
                success: true,
                count: result.rows.length,
                reports: result.rows
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения жалоб:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 5. Получить жалобу по ID с деталями
router.get('/reports/:reportId',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { reportId } = req.params;
            
            const reportResult = await pool.query(
                'SELECT * FROM reports WHERE id = $1',
                [reportId]
            );
            
            if (reportResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Жалоба не найдена'
                });
            }
            
            const report = reportResult.rows[0];
            
            // Получаем информацию о пользователях
            const [reporter, reported] = await Promise.all([
                pool.query(
                    'SELECT user_id, display_name, username, profile_image FROM users WHERE user_id = $1',
                    [report.reporter_id]
                ),
                pool.query(
                    'SELECT user_id, display_name, username, profile_image FROM users WHERE user_id = $1',
                    [report.reported_user_id]
                )
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
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 6. Назначить жалобу модератору
router.patch('/reports/:reportId/assign',
    authMiddleware.authenticate,
    requireModerator,
    moderationController.assignReport
);

// 7. Решить жалобу
router.patch('/reports/:reportId/resolve',
    authMiddleware.authenticate,
    requireModerator,
    moderationController.resolveReport
);

// 8. Эскалировать жалобу
router.patch('/reports/:reportId/escalate',
    authMiddleware.authenticate,
    requireAdmin,
    moderationController.escalateReport
);

// ==================== 🤖 АВТОМОДЕРАЦИЯ ====================

// 9. Сканирование контента
router.post('/scan-content',
    authMiddleware.authenticate,
    requireModerator,
    moderationController.scanContent
);

// 10. Автоматические действия
router.post('/auto-action',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { userId, violations } = req.body;
            
            if (!userId || !violations) {
                return res.status(400).json({
                    success: false,
                    error: 'Требуется userId и violations'
                });
            }
            
            const hasHighSeverity = violations.some(v => v.severity === 'high');
            
            if (hasHighSeverity) {
                // Автоматическая блокировка
                await pool.query(
                    `UPDATE users 
                     SET is_banned = true, ban_expires = $1, warnings = COALESCE(warnings, 0) + 1 
                     WHERE user_id = $2`,
                    [Date.now() + (24 * 60 * 60 * 1000), userId]
                );
                
                res.json({
                    success: true,
                    action: 'auto_ban',
                    duration: 24,
                    message: 'Пользователь автоматически заблокирован на 24 часа'
                });
            } else {
                res.json({
                    success: true,
                    action: 'warning',
                    message: 'Отправлено предупреждение пользователю'
                });
            }
            
        } catch (error) {
            console.error('❌ Ошибка авто-действия:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// ==================== 👤 ДЕЙСТВИЯ С ПОЛЬЗОВАТЕЛЯМИ ====================

// 11. Блокировка пользователя
router.post('/users/:userId/ban',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { userId } = req.params;
            const { duration = 24, reason } = req.body;
            
            const banExpires = Date.now() + (duration * 60 * 60 * 1000);
            
            await pool.query(
                `UPDATE users 
                 SET is_banned = true, ban_expires = $1, warnings = COALESCE(warnings, 0) + 1 
                 WHERE user_id = $2`,
                [banExpires, userId]
            );
            
            // Запись в лог действий
            await pool.query(
                `INSERT INTO moderation_actions (id, target_user_id, action_type, reason, duration, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [`action_${Date.now()}`, userId, 'ban', reason || 'Нарушение правил', duration * 60 * 60 * 1000, Date.now()]
            );
            
            res.json({
                success: true,
                message: `Пользователь ${userId} заблокирован на ${duration} часов`,
                banExpires
            });
            
        } catch (error) {
            console.error('❌ Ошибка блокировки:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 12. Разблокировка пользователя
router.post('/users/:userId/unban',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { userId } = req.params;
            
            await pool.query(
                'UPDATE users SET is_banned = false, ban_expires = NULL WHERE user_id = $1',
                [userId]
            );
            
            res.json({
                success: true,
                message: `Пользователь ${userId} разблокирован`
            });
            
        } catch (error) {
            console.error('❌ Ошибка разблокировки:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 13. История действий модерации для пользователя
router.get('/users/:userId/actions',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { userId } = req.params;
            const { limit = 50 } = req.query;
            
            const result = await pool.query(
                `SELECT * FROM moderation_actions 
                 WHERE target_user_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT $2`,
                [userId, parseInt(limit)]
            );
            
            res.json({
                success: true,
                count: result.rows.length,
                actions: result.rows
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения действий:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// ==================== 📊 ДОПОЛНИТЕЛЬНЫЕ ЭНДПОИНТЫ ====================

// 14. Мои назначенные жалобы
router.get('/my-assigned',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const moderatorId = req.user.userId;
            
            const result = await pool.query(
                `SELECT * FROM reports 
                 WHERE assigned_moderator_id = $1 AND status = 'in_progress'
                 ORDER BY created_at DESC`,
                [moderatorId]
            );
            
            res.json({
                success: true,
                count: result.rows.length,
                reports: result.rows
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения назначенных:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 15. Поиск жалоб по пользователю
router.get('/user-reports/:userId',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const { userId } = req.params;
            
            const result = await pool.query(
                `SELECT * FROM reports 
                 WHERE reporter_id = $1 OR reported_user_id = $1
                 ORDER BY created_at DESC`,
                [userId]
            );
            
            res.json({
                success: true,
                count: result.rows.length,
                reports: result.rows
            });
            
        } catch (error) {
            console.error('❌ Ошибка поиска жалоб:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 16. Быстрая статистика (для дашборда)
router.get('/quick-stats',
    authMiddleware.authenticate,
    requireModerator,
    async (req, res) => {
        try {
            const [total, pending, inProgress, resolved] = await Promise.all([
                pool.query('SELECT COUNT(*) FROM reports'),
                pool.query('SELECT COUNT(*) FROM reports WHERE status = $1', ['pending']),
                pool.query('SELECT COUNT(*) FROM reports WHERE status = $1', ['in_progress']),
                pool.query('SELECT COUNT(*) FROM reports WHERE status = $1', ['resolved'])
            ]);
            
            res.json({
                success: true,
                stats: {
                    total: parseInt(total.rows[0].count),
                    pending: parseInt(pending.rows[0].count),
                    inProgress: parseInt(inProgress.rows[0].count),
                    resolved: parseInt(resolved.rows[0].count)
                }
            });
            
        } catch (error) {
            console.error('❌ Ошибка быстрой статистики:', error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
);

// 17. Health check
router.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'moderation',
        status: 'operational',
        timestamp: new Date().toISOString(),
        endpoints: [
            'GET /queue - очередь жалоб',
            'GET /stats - статистика',
            'POST /reports - создать жалобу',
            'GET /reports - все жалобы',
            'GET /reports/:id - жалоба по ID',
            'PATCH /reports/:id/assign - назначить',
            'PATCH /reports/:id/resolve - решить',
            'POST /scan-content - проверка контента',
            'POST /users/:id/ban - блокировка',
            'GET /quick-stats - быстрая статистика'
        ]
    });
});

module.exports = router;
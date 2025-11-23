const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');
const authMiddleware = require('../middleware/authMiddleware');

// Все роуты требуют аутентификации
router.use(authMiddleware.authenticate);

// Очередь жалоб (только для модераторов и выше)
router.get('/queue', 
    authMiddleware.requirePermission('view_reports'),
    moderationController.getReportQueue
);

// Назначение жалобы модератору
router.patch('/reports/:reportId/assign',
    authMiddleware.requirePermission('respond_reports'),
    moderationController.assignReport
);

// Разрешение жалобы
router.patch('/reports/:reportId/resolve',
    authMiddleware.requirePermission('respond_reports'),
    moderationController.resolveReport
);

// Эскалация жалобы
router.patch('/reports/:reportId/escalate',
    authMiddleware.requirePermission('escalate_cases'),
    moderationController.escalateReport
);

// Автоматическая модерация контента
router.post('/scan-content',
    authMiddleware.requirePermission('view_reports'),
    moderationController.scanContent
);

module.exports = router;
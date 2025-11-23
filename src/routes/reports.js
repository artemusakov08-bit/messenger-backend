const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware.authenticate);

// Пользователь отправляет жалобу
router.post('/send', async (req, res) => {
    try {
        const { reportedUserId, messageId, reason } = req.body;
        
        const report = new Report({
            reporter: req.user.id,
            reportedUser: reportedUserId,
            reportedMessage: messageId,
            reason,
            isPremium: req.user.isPremium
        });

        // Рассчитываем приоритет
        report.priority = await calculatePriority(report);
        await report.save();

        // Уведомляем модераторов через WebSocket
        req.app.get('socketService').notifyNewReport(report);

        res.json({
            success: true,
            message: 'Жалоба отправлена',
            report
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// История жалоб пользователя
router.get('/my-reports', async (req, res) => {
    try {
        const reports = await Report.find({ reporter: req.user.id })
            .sort({ createdAt: -1 })
            .limit(20);

        res.json({
            success: true,
            reports
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function calculatePriority(report) {
    let priority = 'medium';
    if (report.isPremium) priority = 'high';
    
    // Дополнительная логика расчета приоритета
    const user = await User.findById(report.reportedUser);
    if (user && user.warnings >= 3) priority = 'high';
    
    return priority;
}

module.exports = router;
const Report = require('../models/Report');
const ReportQueueService = require('../services/moderation/ReportQueueService');
const AutoModerationService = require('../services/moderation/AutoModerationService');

class ModerationController {
    async getReportQueue(req, res) {
        try {
            const { limit = 50 } = req.query;
            const queue = await ReportQueueService.getPriorityQueue(parseInt(limit));
            
            res.json({
                success: true,
                count: queue.length,
                queue
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async assignReport(req, res) {
        try {
            const { reportId } = req.params;
            const moderatorId = req.user.id;

            const report = await ReportQueueService.assignToModerator(reportId, moderatorId);
            
            if (!report) {
                return res.status(404).json({ error: 'Жалоба не найдена' });
            }

            res.json({
                success: true,
                message: 'Жалоба назначена модератору',
                report
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async resolveReport(req, res) {
        try {
            const { reportId } = req.params;
            const { action, resolution, banDuration } = req.body;

            const report = await Report.findById(reportId);
            if (!report) {
                return res.status(404).json({ error: 'Жалоба не найдена' });
            }

            // Обновляем статус жалобы
            report.status = 'resolved';
            report.resolution = resolution;
            report.resolvedAt = new Date();
            await report.save();

            // Применяем действия
            if (action === 'ban_user') {
                await this.banUser(report.reportedUser, banDuration);
            }

            res.json({
                success: true,
                message: 'Жалоба разрешена',
                report
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async escalateReport(req, res) {
        try {
            const { reportId } = req.params;
            const { reason } = req.body;

            const report = await ReportQueueService.escalateReport(reportId);
            
            res.json({
                success: true,
                message: 'Жалоба эскалирована',
                report,
                reason
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async scanContent(req, res) {
        try {
            const { content } = req.body;
            
            const violations = await AutoModerationService.scanMessage(content);
            const autoAction = await AutoModerationService.autoAction(req.user.id, violations);

            res.json({
                success: true,
                violations,
                autoAction,
                shouldReview: violations.length > 0
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async banUser(userId, duration) {
        // Логика блокировки пользователя
        const user = await User.findById(userId);
        if (user) {
            user.isBanned = true;
            if (duration) {
                user.banExpires = new Date(Date.now() + duration * 60 * 60 * 1000);
            }
            await user.save();
        }
    }
}

module.exports = new ModerationController();
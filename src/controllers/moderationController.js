const Report = require('../models/Report');
const pool = require('../config/database'); // ДОБАВЬТЕ ЭТО

class ModerationController {
    async getReportQueue(req, res) {
        try {
            const { limit = 50 } = req.query;
            const queue = await Report.getPriorityQueue(parseInt(limit));
            
            res.json({
                success: true,
                count: queue.length,
                queue
            });

        } catch (error) {
            console.error('❌ Ошибка получения очереди:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async assignReport(req, res) {
        try {
            const { reportId } = req.params;
            const moderatorId = req.user.id;

            const report = await Report.assignToModerator(reportId, moderatorId);
            
            if (!report) {
                return res.status(404).json({ error: 'Жалоба не найдена' });
            }

            res.json({
                success: true,
                message: 'Жалоба назначена модератору',
                report
            });

        } catch (error) {
            console.error('❌ Ошибка назначения жалобы:', error);
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

            // Обновляем статус жалобы через Report модель
            const updatedReport = await Report.update(reportId, {
                status: 'resolved',
                resolution: resolution,
                resolved_at: Date.now()
            });

            // Применяем действия
            if (action === 'ban_user') {
                await this.banUser(report.reported_user_id, banDuration);
            }

            res.json({
                success: true,
                message: 'Жалоба разрешена',
                report: updatedReport
            });

        } catch (error) {
            console.error('❌ Ошибка разрешения жалобы:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async escalateReport(req, res) {
        try {
            const { reportId } = req.params;
            const { reason } = req.body;

            const report = await Report.escalate(reportId);
            
            res.json({
                success: true,
                message: 'Жалоба эскалирована',
                report,
                reason
            });

        } catch (error) {
            console.error('❌ Ошибка эскалации:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async scanContent(req, res) {
        try {
            const { content } = req.body;
            
            const violations = this.autoModerateContent(content);
            const shouldReview = violations.length > 0;

            res.json({
                success: true,
                violations,
                shouldReview,
                message: shouldReview ? 'Обнаружены нарушения' : 'Контент чист'
            });

        } catch (error) {
            console.error('❌ Ошибка сканирования:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Вспомогательные методы
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
            'угрозы', 'угрожать', 'убить', 'избить'
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
        
        // Проверка на спам
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
        
        return violations;
    }

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
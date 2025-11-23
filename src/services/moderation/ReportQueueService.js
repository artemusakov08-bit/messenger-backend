const Report = require('../../models/Report');

class ReportQueueService {
    static async getPriorityQueue(limit = 50) {
        return await Report.find({ status: 'pending' })
            .populate('reporter', 'phone isPremium')
            .populate('reportedUser', 'phone warnings')
            .sort({ 
                isPremium: -1, 
                priority: -1, 
                createdAt: 1 
            })
            .limit(limit);
    }

    static async assignToModerator(reportId, moderatorId) {
        return await Report.findByIdAndUpdate(reportId, {
            status: 'in_progress',
            assignedModerator: moderatorId
        }, { new: true });
    }

    static async calculatePriority(report) {
        let priority = 'medium';
        
        if (report.isPremium) priority = 'high';
        if (report.reportedUser.warnings >= 3) priority = 'high';
        if (this.containsCriticalKeywords(report.reason)) priority = 'critical';
        
        return priority;
    }

    static containsCriticalKeywords(reason) {
        const criticalKeywords = ['спам', 'мошенничество', 'угрозы', 'оскорбления'];
        return criticalKeywords.some(keyword => 
            reason.toLowerCase().includes(keyword)
        );
    }

    static async escalateReport(reportId, level = 1) {
        return await Report.findByIdAndUpdate(reportId, {
            status: 'escalated',
            escalationLevel: level
        });
    }
}

module.exports = ReportQueueService;
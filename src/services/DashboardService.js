const Report = require('../models/Report');
const User = require('../models/User');
const ModerationAction = require('../models/ModerationAction');

class DashboardService {
    static async getModeratorStats(moderatorId, period = '7d') {
        const startDate = this.getStartDate(period);
        
        const [reportsResolved, avgResolutionTime, escalationRate] = await Promise.all([
            // Количество разрешенных жалоб
            Report.countDocuments({
                assignedModerator: moderatorId,
                status: 'resolved',
                resolvedAt: { $gte: startDate }
            }),
            
            // Среднее время решения
            this.calculateAverageResolutionTime(moderatorId, startDate),
            
            // Процент эскалаций
            this.calculateEscalationRate(moderatorId, startDate)
        ]);

        return {
            reportsResolved,
            avgResolutionTime: `${avgResolutionTime} мин`,
            escalationRate: `${escalationRate}%`,
            performanceScore: this.calculatePerformanceScore(reportsResolved, escalationRate)
        };
    }

    static async getSystemStats(period = '7d') {
        const startDate = this.getStartDate(period);
        
        const [
            totalReports,
            resolvedReports,
            pendingReports,
            premiumReports,
            autoModerated
        ] = await Promise.all([
            Report.countDocuments({ createdAt: { $gte: startDate } }),
            Report.countDocuments({ status: 'resolved', resolvedAt: { $gte: startDate } }),
            Report.countDocuments({ status: 'pending' }),
            Report.countDocuments({ isPremium: true, createdAt: { $gte: startDate } }),
            ModerationAction.countDocuments({ type: 'auto', createdAt: { $gte: startDate } })
        ]);

        const resolutionRate = totalReports > 0 ? (resolvedReports / totalReports * 100).toFixed(1) : 0;
        const avgResponseTime = await this.calculateSystemAvgResponseTime(startDate);

        return {
            totalReports,
            resolvedReports,
            pendingReports,
            premiumReports,
            autoModerated,
            resolutionRate: `${resolutionRate}%`,
            avgResponseTime: `${avgResponseTime} мин`,
            priorityBreakdown: await this.getPriorityBreakdown(startDate)
        };
    }

    static async getPriorityBreakdown(startDate) {
        const breakdown = await Report.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]);
        
        return breakdown.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, {});
    }

    static async calculateAverageResolutionTime(moderatorId, startDate) {
        const result = await Report.aggregate([
            {
                $match: {
                    assignedModerator: moderatorId,
                    status: 'resolved',
                    resolvedAt: { $gte: startDate }
                }
            },
            {
                $project: {
                    resolutionTime: {
                        $divide: [
                            { $subtract: ['$resolvedAt', '$createdAt'] },
                            60000 // в минуты
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    avgTime: { $avg: '$resolutionTime' }
                }
            }
        ]);

        return result.length > 0 ? Math.round(result[0].avgTime) : 0;
    }

    static calculatePerformanceScore(resolved, escalationRate) {
        const baseScore = resolved * 10;
        const penalty = escalationRate * 5;
        return Math.max(0, baseScore - penalty);
    }

    static getStartDate(period) {
        const now = new Date();
        switch (period) {
            case '24h': return new Date(now.setDate(now.getDate() - 1));
            case '7d': return new Date(now.setDate(now.getDate() - 7));
            case '30d': return new Date(now.setDate(now.getDate() - 30));
            default: return new Date(now.setDate(now.getDate() - 7));
        }
    }
}

module.exports = DashboardService;
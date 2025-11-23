const DashboardService = require('../services/DashboardService');
const RolePermissionService = require('../services/auth/RolePermissionService');

class DashboardController {
    async getDashboard(req, res) {
        try {
            const { period = '7d' } = req.query;
            const userRole = req.user.role;

            let dashboardData = {};

            // Базовая статистика для всех модераторов и выше
            if (RolePermissionService.hasPermission(userRole, 'view_analytics')) {
                dashboardData.systemStats = await DashboardService.getSystemStats(period);
            }

            // Статистика модератора (если пользователь - модератор)
            if (['moderator', 'admin', 'lead', 'super_admin'].includes(userRole)) {
                dashboardData.moderatorStats = await DashboardService.getModeratorStats(
                    req.user.id, 
                    period
                );
            }

            // Расширенная аналитика для админов и выше
            if (['admin', 'lead', 'super_admin'].includes(userRole)) {
                dashboardData.advancedAnalytics = await this.getAdvancedAnalytics(period);
            }

            res.json({
                success: true,
                period,
                role: userRole,
                ...dashboardData
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getModeratorPerformance(req, res) {
        try {
            const { period = '7d' } = req.query;
            
            // Только для руководства
            if (!RolePermissionService.hasPermission(req.user.role, 'manage_moderators')) {
                return res.status(403).json({ error: 'Недостаточно прав' });
            }

            const moderators = await User.find({ 
                role: { $in: ['moderator', 'admin'] } 
            });

            const performanceData = await Promise.all(
                moderators.map(async (moderator) => ({
                    moderator: {
                        id: moderator.id,
                        phone: moderator.phone,
                        role: moderator.role
                    },
                    stats: await DashboardService.getModeratorStats(moderator.id, period)
                }))
            );

            res.json({
                success: true,
                performanceData: performanceData.sort((a, b) => 
                    b.stats.performanceScore - a.stats.performanceScore
                )
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getAdvancedAnalytics(period) {
        // Расширенная аналитика для руководства
        return {
            topReportedUsers: await this.getTopReportedUsers(period),
            commonViolations: await this.getCommonViolations(period),
            timeDistribution: await this.getTimeDistribution(period)
        };
    }

    async getTopReportedUsers(period) {
        const startDate = DashboardService.getStartDate(period);
        
        return await Report.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$reportedUser', reports: { $sum: 1 } } },
            { $sort: { reports: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            }
        ]);
    }

    async getCommonViolations(period) {
        const startDate = DashboardService.getStartDate(period);
        
        return await Report.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$reason', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);
    }
}

module.exports = new DashboardController();
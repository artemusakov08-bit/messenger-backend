const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RolePermissionService = require('../services/auth/RolePermissionService');

const authMiddleware = {
    authenticate: async (req, res, next) => {
        try {
            const token = req.header('Authorization')?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({ error: 'Токен отсутствует' });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.userId);
            
            if (!user) {
                return res.status(401).json({ error: 'Пользователь не найден' });
            }

            req.user = user;
            next();
        } catch (error) {
            res.status(401).json({ error: 'Неверный токен' });
        }
    },

    requireRole: (roles) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: 'Требуется аутентификация' });
            }

            if (!Array.isArray(roles)) {
                roles = [roles];
            }

            if (!roles.includes(req.user.role)) {
                return res.status(403).json({ 
                    error: 'Недостаточно прав',
                    required: roles,
                    current: req.user.role
                });
            }

            next();
        };
    },

    requirePermission: (permission) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: 'Требуется аутентификация' });
            }

            if (!RolePermissionService.hasPermission(req.user.role, permission)) {
                return res.status(403).json({ 
                    error: 'Недостаточно прав',
                    required: permission,
                    current: req.user.role
                });
            }

            next();
        };
    }
};

module.exports = authMiddleware;
const jwt = require('jsonwebtoken');
const pool = require('../config/database'); // Изменяем на подключение к PostgreSQL
const RolePermissionService = require('../services/auth/RolePermissionService');

const authMiddleware = {
    authenticate: async (req, res, next) => {
        try {
            const token = req.header('Authorization')?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({ 
                    success: false,
                    error: 'Токен отсутствует. Пользователь не авторизован.' 
                });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Используем pool для PostgreSQL
            const userResult = await pool.query(
                'SELECT user_id, display_name, username, phone, role, status, profile_image FROM users WHERE user_id = $1',
                [decoded.userId]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(401).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const user = userResult.rows[0];
            req.user = user;
            req.userId = user.user_id; // Добавляем userId для удобства
            next();
        } catch (error) {
            console.error('❌ Auth middleware error:', error.message);
            
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({ 
                    success: false,
                    error: 'Неверный токен авторизации' 
                });
            }
            
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    success: false,
                    error: 'Срок действия токена истек' 
                });
            }
            
            res.status(401).json({ 
                success: false,
                error: 'Ошибка авторизации: ' + error.message 
            });
        }
    },

    requireRole: (roles) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ 
                    success: false,
                    error: 'Требуется аутентификация' 
                });
            }

            if (!Array.isArray(roles)) {
                roles = [roles];
            }

            if (!roles.includes(req.user.role)) {
                return res.status(403).json({ 
                    success: false,
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
                return res.status(401).json({ 
                    success: false,
                    error: 'Требуется аутентификация' 
                });
            }

            if (!RolePermissionService.hasPermission(req.user.role, permission)) {
                return res.status(403).json({ 
                    success: false,
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
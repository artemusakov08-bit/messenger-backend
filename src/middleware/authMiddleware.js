const jwt = require('jsonwebtoken');
const pool = require('../config/database'); // Изменяем на подключение к PostgreSQL
const RolePermissionService = require('../services/auth/RolePermissionService');

const authMiddleware = {
authenticate: async (req, res, next) => {
    try {
        // 🔥 ПРАВИЛЬНОЕ ПОЛУЧЕНИЕ ТОКЕНА
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        
        if (!authHeader) {
            console.log('❌ Нет заголовка Authorization');
            return res.status(401).json({ 
                success: false,
                error: 'Требуется авторизация' 
            });
        }
        
        console.log('🔐 Полный заголовок Authorization:', authHeader);
        
        // 🔥 ИЗВЛЕЧЕНИЕ ТОКЕНА (поддерживаем Bearer и без него)
        let token;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else {
            token = authHeader;
        }
        
        // 🔥 ПРОВЕРКА JWT_SECRET
        if (!process.env.JWT_SECRET) {
            console.error('❌❌❌ ОШИБКА: JWT_SECRET не установлен!');
            console.error('❌❌❐ Проверь .env файл: JWT_SECRET=твой_ключ_здесь');
            return res.status(500).json({ 
                success: false,
                error: 'Ошибка конфигурации сервера' 
            });
        }
        
        console.log('🔐 JWT_SECRET установлен (первые 5 символов):', 
            process.env.JWT_SECRET.substring(0, Math.min(5, process.env.JWT_SECRET.length)) + '...');
        
        // 🔥 ВЕРИФИКАЦИЯ ТОКЕНА
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 🔥 ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЯ ИЗ БАЗЫ
        const userResult = await pool.query(
            'SELECT user_id, display_name, username, phone, role, status, profile_image FROM users WHERE user_id = $1',
            [decoded.userId]
        );
        
        if (userResult.rows.length === 0) {
            console.log('❌ Пользователь не найден в БД:', decoded.userId);
            return res.status(401).json({ 
                success: false,
                error: 'Пользователь не найден' 
            });
        }

        const user = userResult.rows[0];
        req.user = user;
        req.userId = user.user_id;
        
        console.log('✅ Аутентификация успешна. Пользователь:', user.user_id, '-', user.display_name);
        
        next();
        
    } catch (error) {
        console.error('❌ ОШИБКА АУТЕНТИФИКАЦИИ:', error.message);
        
        if (error.name === 'JsonWebTokenError') {
            console.error('❌ Неверный формат токена:', error.message);
            return res.status(401).json({ 
                success: false,
                error: 'Неверный токен авторизации' 
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            console.error('❌ Токен истек');
            return res.status(401).json({ 
                success: false,
                error: 'Срок действия токена истек' 
            });
        }
        
        if (error.name === 'SyntaxError') {
            console.error('❌ Синтаксическая ошибка в токене');
            return res.status(401).json({ 
                success: false,
                error: 'Неверный формат токена' 
            });
        }
        
        console.error('❌ Другая ошибка:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка аутентификации: ' + error.message 
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
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authMiddleware = {
    authenticate: async (req, res, next) => {
        try {
            console.log('🔐 === НАЧАЛО АУТЕНТИФИКАЦИИ ===');
            
            const authHeader = req.headers['authorization'] || req.headers['Authorization'];
            console.log('📨 Заголовок Authorization:', authHeader ? 'есть' : 'нет');
            
            if (!authHeader) {
                console.log('❌ Нет заголовка Authorization');
                return res.status(401).json({ 
                    success: false,
                    error: 'Требуется авторизация. Добавьте: Authorization: Bearer <token>' 
                });
            }
            
            let token;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            } else {
                token = authHeader;
            }
            
            console.log('🔑 Токен получен, длина:', token.length);
            
            if (!process.env.JWT_SECRET) {
                console.error('❌ JWT_SECRET не установлен');
                return res.status(500).json({ 
                    success: false,
                    error: 'Ошибка сервера' 
                });
            }
            
            // Декодируем без проверки сначала
            let decoded;
            try {
                decoded = jwt.decode(token);
                console.log('📋 Декодированный токен:', decoded);
            } catch (decodeError) {
                console.error('❌ Ошибка декодирования токена:', decodeError);
                return res.status(401).json({ 
                    success: false,
                    error: 'Неверный формат токена' 
                });
            }
            
            if (!decoded || !decoded.userId) {
                console.error('❌ Токен не содержит userId');
                return res.status(401).json({ 
                    success: false,
                    error: 'Неверный токен' 
                });
            }
            
            // Проверяем подпись токена
            try {
                jwt.verify(token, process.env.JWT_SECRET);
                console.log('✅ Токен верифицирован');
            } catch (verifyError) {
                console.error('❌ Ошибка верификации токена:', verifyError.message);
                
                if (verifyError.name === 'TokenExpiredError') {
                    return res.status(401).json({ 
                        success: false,
                        error: 'Токен истек',
                        requiresRefresh: true
                    });
                }
                
                return res.status(401).json({ 
                    success: false,
                    error: 'Неверный токен' 
                });
            }
            
            const { userId } = decoded;
            
            // ИЩЕМ ПОЛЬЗОВАТЕЛЯ В БАЗЕ
            const client = await db.getClient();
            try {
                console.log('🔍 Поиск пользователя:', userId);
                
                const userResult = await client.query(
                    'SELECT user_id, username, display_name, phone, role, status FROM users WHERE user_id = $1',
                    [userId]
                );
                
                if (userResult.rows.length === 0) {
                    console.log('❌ Пользователь не найден в БД:', userId);
                    return res.status(404).json({ 
                        success: false,
                        error: 'Пользователь не найден' 
                    });
                }
                
                const user = userResult.rows[0];
                console.log('✅ Пользователь найден:', user.user_id);
                
                // ПРОВЕРЯЕМ СЕССИЮ В БАЗЕ
                console.log('🔍 Поиск активной сессии для пользователя');
                const sessionResult = await client.query(
                    `SELECT * FROM sessions 
                     WHERE user_id = $1 
                     AND is_active = true 
                     AND access_token_expires_at > NOW()
                     ORDER BY last_active_at DESC 
                     LIMIT 1`,
                    [userId]
                );
                
                if (sessionResult.rows.length === 0) {
                    console.log('⚠️ Активная сессия не найдена, проверяем любую сессию');
                    
                    // Проверяем любую сессию пользователя
                    const anySessionResult = await client.query(
                        'SELECT * FROM sessions WHERE user_id = $1 ORDER BY last_active_at DESC LIMIT 1',
                        [userId]
                    );
                    
                    if (anySessionResult.rows.length > 0) {
                        const session = anySessionResult.rows[0];
                        if (!session.is_active) {
                            console.log('❌ Сессия неактивна');
                            return res.status(401).json({ 
                                success: false,
                                error: 'Сессия неактивна' 
                            });
                        }
                        
                        if (new Date() > new Date(session.access_token_expires_at)) {
                            console.log('❌ Токен сессии истек');
                            return res.status(401).json({ 
                                success: false,
                                error: 'Токен истек',
                                requiresRefresh: true
                            });
                        }
                    } else {
                        console.log('❌ Сессий не найдено');
                        return res.status(401).json({ 
                            success: false,
                            error: 'Сессия не найдена' 
                        });
                    }
                }
                
                // Обновляем активность
                await client.query(
                    'UPDATE users SET last_seen = $1 WHERE user_id = $2',
                    [Date.now(), userId]
                );
                
                req.user = {
                    userId: user.user_id,
                    username: user.username,
                    displayName: user.display_name,
                    phone: user.phone,
                    role: user.role,
                    status: user.status
                };
                
                req.userId = user.user_id;
                
                console.log('✅ Аутентификация успешна для:', user.user_id);
                console.log('👤 Данные пользователя:', {
                    id: user.user_id,
                    username: user.username,
                    role: user.role
                });
                
                next();
            } finally {
                client.release();
            }
            
        } catch (error) {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА АУТЕНТИФИКАЦИИ:', error);
            console.error('Stack:', error.stack);
            
            res.status(500).json({ 
                success: false,
                error: 'Ошибка сервера при аутентификации',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
                    error: 'Недостаточно прав' 
                });
            }
            
            next();
        };
    }
};

module.exports = authMiddleware;
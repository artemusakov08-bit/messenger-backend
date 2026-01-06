const jwtUtils = require('../utils/jwtUtils');
const DeviceSession = require('../models/DeviceSession');

const deviceAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }

        const accessToken = authHeader.split(' ')[1];
        
        // Валидация access токена
        const tokenResult = jwtUtils.verifyAccessToken(accessToken);
        
        if (!tokenResult.valid) {
            // Если токен истек, проверяем можно ли его обновить
            if (tokenResult.error.includes('expired')) {
                return res.status(401).json({
                    success: false,
                    error: 'Токен истек',
                    code: 'TOKEN_EXPIRED'
                });
            }
            
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }

        const { userId, deviceId } = tokenResult.decoded;
        
        // Проверяем активность сессии в БД
        const session = await DeviceSession.findOne({
            where: {
                userId,
                deviceId,
                accessToken,
                isActive: true
            }
        });

        if (!session) {
            return res.status(401).json({
                success: false,
                error: 'Сессия не найдена'
            });
        }

        if (session.isAccessTokenExpired()) {
            return res.status(401).json({
                success: false,
                error: 'Токен истек',
                code: 'TOKEN_EXPIRED'
            });
        }

        // Обновляем время последней активности
        await session.updateLastActive();
        
        // Добавляем данные в запрос
        req.userId = userId;
        req.deviceId = deviceId;
        req.sessionId = session.id;
        
        next();
    } catch (error) {
        console.error('❌ Device auth error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка аутентификации'
        });
    }
};

module.exports = deviceAuthMiddleware;
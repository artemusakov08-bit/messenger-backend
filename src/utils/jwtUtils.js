const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const jwtUtils = {
    // 🔐 ГЕНЕРАЦИЯ ТОКЕНА
    generateToken: (userId, expiresIn = '7d') => {
        try {
            if (!process.env.JWT_SECRET) {
                throw new Error('JWT_SECRET не установлен в .env файле');
            }
            
            const token = jwt.sign(
                { 
                    userId: userId,
                    iat: Math.floor(Date.now() / 1000)
                },
                process.env.JWT_SECRET,
                { expiresIn: expiresIn }
            );
            
            return token;
        } catch (error) {
            console.error('❌ Error generating token:', error);
            throw new Error('Ошибка генерации токена: ' + error.message);
        }
    },

    // 🔍 ВАЛИДАЦИЯ ТОКЕНА
    verifyToken: (token) => {
        try {
            if (!process.env.JWT_SECRET) {
                throw new Error('JWT_SECRET не установлен в .env файле');
            }
            
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            return { valid: true, decoded };
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return { valid: false, error: 'Токен истек' };
            }
            if (error.name === 'JsonWebTokenError') {
                return { valid: false, error: 'Неверный токен' };
            }
            return { valid: false, error: error.message };
        }
    },

    // 📋 ПОЛУЧИТЬ ДАННЫЕ ИЗ ТОКЕНА (без валидации)
    decodeToken: (token) => {
        try {
            return jwt.decode(token);
        } catch (error) {
            console.error('❌ Error decoding token:', error);
            return null;
        }
    },

    // 🔑 ГЕНЕРАЦИЯ ПАРЫ ТОКЕНОВ (исправленный метод)
    generateTokenPair: (userId, deviceId) => {
        const accessToken = jwt.sign(
            { userId, deviceId, type: 'access' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        const refreshToken = jwt.sign(
            { userId, deviceId, type: 'refresh' },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh',
            { expiresIn: '30d' }
        );
        
        return { 
            accessToken, 
            refreshToken,
            accessTokenExpiresIn: 3600,
            refreshTokenExpiresIn: 2592000
        };
    },

    // 🎫 ГЕНЕРАЦИЯ SESSION TOKEN
    generateSessionToken: (userId, deviceId) => {
        const randomBytes = crypto.randomBytes(32).toString('hex');
        const timestamp = Date.now();
        return `sess_${userId}_${deviceId}_${timestamp}_${randomBytes}`;
    },

    // 🔄 ГЕНЕРАЦИЯ REFRESH TOKEN С ПОДПИСЬЮ
    generateSecureRefreshToken: (userId, deviceId, ipAddress = '') => {
        const payload = {
            userId,
            deviceId,
            type: 'refresh',
            ip: ipAddress,
            iat: Math.floor(Date.now() / 1000)
        };
        
        return jwt.sign(
            payload,
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh',
            { expiresIn: '30d' }
        );
    },

    // 🔍 ВАЛИДАЦИЯ REFRESH TOKEN
    verifyRefreshToken: (token) => {
        try {
            const decoded = jwt.verify(
                token, 
                process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh'
            );
            return { valid: true, decoded };
        } catch (error) {
            return { 
                valid: false, 
                error: error.name,
                message: error.message 
            };
        }
    },

    // 🔐 ГЕНЕРАЦИЯ OPERATION TOKEN (для 2FA и т.д.)
    generateOperationToken: (userId, operation, expiresIn = '5m') => {
        return jwt.sign(
            { 
                userId, 
                type: 'operation',
                operation,
                iat: Math.floor(Date.now() / 1000)
            },
            process.env.JWT_SECRET,
            { expiresIn }
        );
    },

    // 🛡️ ВАЛИДАЦИЯ OPERATION TOKEN
    verifyOperationToken: (token, expectedOperation = null) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            if (decoded.type !== 'operation') {
                return { valid: false, error: 'Неверный тип токена' };
            }
            
            if (expectedOperation && decoded.operation !== expectedOperation) {
                return { valid: false, error: 'Несоответствие операции' };
            }
            
            return { valid: true, decoded };
        } catch (error) {
            return { 
                valid: false, 
                error: error.name,
                message: error.message 
            };
        }
    }
};

module.exports = jwtUtils;
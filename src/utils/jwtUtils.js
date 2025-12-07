const jwt = require('jsonwebtoken');

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
    }
};

module.exports = jwtUtils;
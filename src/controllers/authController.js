const User = require('../models/User');
const MultiLevelAuthService = require('../services/auth/MultiLevelAuthService');
const jwt = require('jsonwebtoken');

class AuthController {
    async multiLevelLogin(req, res) {
        try {
            const { phone, smsCode, password, secretWord, extraPassword } = req.body;
            
            // Находим пользователя
            const user = await User.findOne({ phone });
            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            // Проверяем SMS код
            const isSMSValid = await MultiLevelAuthService.verifySMS(user.id, smsCode);
            if (!isSMSValid) {
                return res.status(401).json({ error: 'Неверный SMS код' });
            }

            // Проверяем дополнительные уровни аутентификации
            const authData = { sms: true };
            
            if (password) {
                authData.password = await MultiLevelAuthService.verifyPassword(user.id, password);
            }
            
            if (secretWord) {
                authData.secretWord = await MultiLevelAuthService.verifySecretWord(user.role, secretWord);
            }
            
            if (extraPassword) {
                authData.extraPassword = await MultiLevelAuthService.verifyExtraPassword(user.role, extraPassword);
            }

            // Проверяем соответствие требованиям роли
            const isValid = MultiLevelAuthService.validateAuthLevel(user.role, authData);
            if (!isValid) {
                return res.status(401).json({ error: 'Недостаточно уровней аутентификации' });
            }

            // Генерируем токен
            const token = jwt.sign(
                { 
                    userId: user.id, 
                    role: user.role,
                    authLevel: Object.keys(authData).length
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                token,
                user: {
                    id: user.id,
                    phone: user.phone,
                    role: user.role,
                    authLevel: Object.keys(authData).length
                }
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getAuthRequirements(req, res) {
        try {
            const { phone } = req.params;
            const user = await User.findOne({ phone });
            
            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const requirements = MultiLevelAuthService.authRequirements[user.role] || [];
            
            res.json({
                role: user.role,
                requirements,
                message: `Требуемые уровни аутентификации: ${requirements.join(', ')}`
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new AuthController();
const User = require('../models/User');
const MultiLevelAuthService = require('../services/auth/MultiLevelAuthService');
const jwt = require('jsonwebtoken');

class AuthController {
    // ✅ РЕГИСТРАЦИЯ
    async register(req, res) {
        try {
            const { phone, password, role } = req.body;

            console.log('Registration attempt:', { phone, role });

            // Проверка обязательных полей
            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            // Проверка существующего пользователя
            const existingUser = await User.findOne({ phone });
            if (existingUser) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Пользователь с таким телефоном уже существует' 
                });
            }

            // Создание нового пользователя
            const newUser = new User({
                phone,
                password: password || 'default123',
                role: role || 'user',
                isPremium: false,
                isBanned: false,
                warnings: 0,
                authLevel: 'sms_only'
            });

            await newUser.save();
            console.log('User registered successfully:', newUser._id);

            // Генерируем токен
            const token = jwt.sign(
                { 
                    userId: newUser._id, 
                    role: newUser.role
                },
                process.env.JWT_SECRET || 'fallback-secret',
                { expiresIn: '24h' }
            );

            res.status(201).json({
                success: true,
                message: 'Пользователь успешно зарегистрирован',
                token: token,
                user: {
                    id: newUser._id,
                    phone: newUser.phone,
                    role: newUser.role,
                    authLevel: newUser.authLevel
                }
            });

        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка сервера при регистрации: ' + error.message 
            });
        }
    }

    // ✅ УПРОЩЕННЫЙ ВХОД ДЛЯ ТЕСТА
    async multiLevelLogin(req, res) {
        try {
            const { phone, smsCode } = req.body;
            
            // Находим пользователя
            const user = await User.findOne({ phone });
            if (!user) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            // Упрощенная проверка SMS (всегда true для теста)
            const isSMSValid = true;
            if (!isSMSValid) {
                return res.status(401).json({ 
                    success: false,
                    error: 'Неверный SMS код' 
                });
            }

            // Генерируем токен
            const token = jwt.sign(
                { 
                    userId: user._id, 
                    role: user.role
                },
                process.env.JWT_SECRET || 'fallback-secret',
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token,
                user: {
                    id: user._id,
                    phone: user.phone,
                    role: user.role
                }
            });

        } catch (error) {
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    async getAuthRequirements(req, res) {
        try {
            const { phone } = req.params;
            const user = await User.findOne({ phone });
            
            if (!user) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            res.json({
                success: true,
                role: user.role,
                requirements: ['sms'],
                message: 'Требуется SMS аутентификация'
            });

        } catch (error) {
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }
}

module.exports = new AuthController();
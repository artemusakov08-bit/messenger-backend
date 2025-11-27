const User = require('../models/User');
const MultiLevelAuthService = require('../services/auth/MultiLevelAuthService');
const jwt = require('jsonwebtoken');

class AuthController {
    async register(req, res) {
        try {
            const { phone } = req.body;

            console.log('Registration attempt:', { phone });

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            const existingUser = await User.findOne({ phone });
            if (existingUser) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Пользователь с таким телефоном уже существует' 
                });
            }

            // 🔥 АВТОГЕНЕРАЦИЯ ВСЕХ НУЖНЫХ ПОЛЕЙ
            const timestamp = Date.now();
            const username = "user_" + timestamp;
            const displayName = "User " + phone.slice(-4);

            const newUser = new User({
                phone,
                username, // 🔥 АВТОМАТИЧЕСКИ ГЕНЕРИРУЕМ
                displayName, // 🔥 АВТОМАТИЧЕСКИ ГЕНЕРИРУЕМ
                password: null,
                role: 'user',
                isPremium: false,
                isBanned: false,
                warnings: 0,
                authLevel: 'sms_only'
            });

            await newUser.save();
            console.log('User registered successfully:', newUser._id);

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
                    username: newUser.username,
                    displayName: newUser.displayName,
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

    async multiLevelLogin(req, res) {
        try {
            const { phone, smsCode } = req.body;
            
            const user = await User.findOne({ phone });
            if (!user) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const isSMSValid = true;
            if (!isSMSValid) {
                return res.status(401).json({ 
                    success: false,
                    error: 'Неверный SMS код' 
                });
            }

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
                    username: user.username,
                    displayName: user.displayName,
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
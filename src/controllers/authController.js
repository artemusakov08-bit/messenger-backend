const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { UserSecurity, VerificationCode } = require('../models');
const DeviceSession = require('../models/DeviceSession');
const jwtUtils = require('../utils/jwtUtils');

console.log('🔑 === ПРОВЕРКА JWT_SECRET ===');
console.log('🔑 JWT_SECRET в process.env:', process.env.JWT_SECRET ? 'ЕСТЬ' : 'НЕТ');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('❌ ОШИБКА: JWT_SECRET не найден в переменных окружения Render');
    throw new Error('JWT_SECRET не настроен в Render Environment Variables');
}

console.log('✅ JWT_SECRET загружен');
console.log('🔑 Длина ключа:', JWT_SECRET.length);
console.log('🔑 Первые 5 символов:', JWT_SECRET.substring(0, 5) + '...');
console.log('🚀 AuthController инициализирован');

class AuthController {
    async sendVerificationCode(req, res) {
        try {
            const { phone, type = 'sms' } = req.body;
            console.log('📱 Отправка кода для:', phone);

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            
            await VerificationCode.create({
                phone: phone,
                code: code,
                type: type,
                expiresInMinutes: 10
            });

            console.log('✅ Код создан:', { phone, code });

            res.json({
                success: true,
                message: 'Код подтверждения отправлен',
                code: code,
                expiresIn: 10
            });

        } catch (error) {
            console.error('❌ Ошибка отправки кода:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка отправки кода: ' + error.message 
            });
        }
    }

    async checkUserRegistration(req, res) {
        const client = await db.getClient();
        try {
            const { phone } = req.body;
            console.log('🔍 Проверка регистрации:', phone);

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );

            if (userResult.rows.length === 0) {
                console.log('🆕 Пользователь не найден:', phone);
                return res.status(200).json({ 
                    success: false,
                    needsRegistration: true,
                    error: 'Пользователь не найден. Требуется регистрация.' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            console.log('✅ Пользователь найден:', user.user_id);

            res.json({
                success: true,
                userExists: true,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    is_premium: user.is_premium,
                    authLevel: user.auth_level
                },
                security: {
                    twoFAEnabled: securitySettings?.two_fa_enabled || false,
                    codeWordEnabled: securitySettings?.code_word_enabled || false,
                    securityLevel: securitySettings?.security_level || 'low'
                }
            });
        } catch (error) {
            console.error('❌ Ошибка проверки регистрации:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка проверки пользователя: ' + error.message 
            });
        } finally {
            client.release();
        }
    }

    // 🆕 СОЗДАНИЕ СЕССИИ УСТРОЙСТВА
    async createDeviceSession(req, res) {
        const client = await db.getClient();
        try {
            const { userId, deviceId, deviceInfo = {} } = req.body;
            
            if (!userId || !deviceId) {
                return res.status(400).json({
                    success: false,
                    error: 'ID пользователя и устройства обязательны'
                });
            }

            // Проверяем существование пользователя
            const userResult = await client.query(
                'SELECT * FROM users WHERE user_id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }

            // Генерируем пару токенов
            const tokenPair = jwtUtils.generateTokenPair(userId, deviceId);
            
            // Вычисляем даты истечения
            const now = new Date();
            const accessTokenExpiresAt = new Date(now.getTime() + 3600 * 1000); // +1 час
            const refreshTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000); // +30 дней

            // Создаем или обновляем сессию
            const [session, created] = await DeviceSession.findOrCreate({
                where: { userId, deviceId },
                defaults: {
                    deviceName: deviceInfo.deviceName || 'Android Device',
                    deviceInfo,
                    accessToken: tokenPair.accessToken,
                    refreshToken: tokenPair.refreshToken,
                    accessTokenExpiresAt,
                    refreshTokenExpiresAt,
                    ipAddress: req.ip,
                    isActive: true
                }
            });

            if (!created) {
                // Обновляем существующую сессию
                session.accessToken = tokenPair.accessToken;
                session.refreshToken = tokenPair.refreshToken;
                session.accessTokenExpiresAt = accessTokenExpiresAt;
                session.refreshTokenExpiresAt = refreshTokenExpiresAt;
                session.deviceInfo = deviceInfo;
                session.ipAddress = req.ip;
                session.isActive = true;
                session.lastActiveAt = now;
                await session.save();
            }

            console.log(`✅ ${created ? 'Создана' : 'Обновлена'} сессия для устройства:`, deviceId);

            res.json({
                success: true,
                session: {
                    id: session.id,
                    deviceId: session.deviceId,
                    deviceName: session.deviceName,
                    createdAt: session.createdAt
                },
                tokens: {
                    accessToken: tokenPair.accessToken,
                    refreshToken: tokenPair.refreshToken,
                    accessTokenExpiresIn: tokenPair.accessTokenExpiresIn,
                    refreshTokenExpiresIn: tokenPair.refreshTokenExpiresIn,
                    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
                    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString()
                },
                user: {
                    id: userResult.rows[0].user_id,
                    username: userResult.rows[0].username,
                    displayName: userResult.rows[0].display_name
                }
            });

        } catch (error) {
            console.error('❌ Ошибка создания сессии:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка создания сессии: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    // 🔄 ОБНОВЛЕНИЕ ACCESS TOKEN
    async refreshToken(req, res) {
        try {
            const { refreshToken } = req.body;
            
            if (!refreshToken) {
                return res.status(400).json({
                    success: false,
                    error: 'Refresh token обязателен'
                });
            }

            // Валидация refresh токена
            const tokenResult = jwtUtils.verifyRefreshToken(refreshToken);
            
            if (!tokenResult.valid) {
                return res.status(401).json({
                    success: false,
                    error: 'Неверный refresh token'
                });
            }

            const { userId, deviceId } = tokenResult.decoded;
            
            // Ищем активную сессию
            const session = await DeviceSession.findByRefreshToken(refreshToken);
            
            if (!session) {
                return res.status(401).json({
                    success: false,
                    error: 'Сессия не найдена или неактивна'
                });
            }

            // Генерируем новую пару токенов
            const tokenPair = jwtUtils.generateTokenPair(userId, deviceId);
            
            // Обновляем токены в сессии
            const now = new Date();
            session.accessToken = tokenPair.accessToken;
            session.refreshToken = tokenPair.refreshToken;
            session.accessTokenExpiresAt = new Date(now.getTime() + 3600 * 1000);
            session.refreshTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
            session.lastActiveAt = now;
            await session.save();

            console.log(`✅ Токены обновлены для устройства:`, deviceId);

            res.json({
                success: true,
                accessToken: tokenPair.accessToken,
                refreshToken: tokenPair.refreshToken,
                accessTokenExpiresIn: tokenPair.accessTokenExpiresIn,
                refreshTokenExpiresIn: tokenPair.refreshTokenExpiresIn,
                accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString()
            });

        } catch (error) {
            console.error('❌ Ошибка обновления токена:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка обновления токена: ' + error.message
            });
        }
    }

    // 📋 ПОЛУЧЕНИЕ АКТИВНЫХ СЕССИЙ ПОЛЬЗОВАТЕЛЯ
    async getSessions(req, res) {
        try {
            const { userId } = req;
            
            const sessions = await DeviceSession.getUserSessions(userId);
            
            const formattedSessions = sessions.map(session => ({
                id: session.id,
                deviceId: session.deviceId,
                deviceName: session.deviceName,
                deviceInfo: session.deviceInfo,
                ipAddress: session.ipAddress,
                location: session.location,
                createdAt: session.createdAt,
                lastActiveAt: session.lastActiveAt,
                isCurrent: session.deviceId === req.deviceId,
                isActive: session.isActive
            }));

            res.json({
                success: true,
                sessions: formattedSessions,
                count: sessions.length
            });

        } catch (error) {
            console.error('❌ Ошибка получения сессий:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка получения сессий: ' + error.message
            });
        }
    }

    // 🚪 ЗАВЕРШЕНИЕ КОНКРЕТНОЙ СЕССИИ
    async endSession(req, res) {
        try {
            const { userId } = req;
            const { sessionId } = req.params;
            
            const session = await DeviceSession.findOne({
                where: {
                    id: sessionId,
                    userId
                }
            });
            
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: 'Сессия не найдена'
                });
            }

            // Нельзя завершить текущую сессию через этот метод
            if (session.deviceId === req.deviceId) {
                return res.status(400).json({
                    success: false,
                    error: 'Для завершения текущей сессии используйте logout'
                });
            }

            await session.deactivate();
            
            res.json({
                success: true,
                message: 'Сессия завершена',
                sessionId: session.id
            });

        } catch (error) {
            console.error('❌ Ошибка завершения сессии:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка завершения сессии: ' + error.message
            });
        }
    }

    // 🚫 ЗАВЕРШЕНИЕ ВСЕХ СЕССИЙ (кроме текущей)
    async endAllSessions(req, res) {
        const client = await db.getClient();
        try {
            const { userId, deviceId } = req;
            
            await DeviceSession.update(
                { isActive: false },
                {
                    where: {
                        userId,
                        deviceId: { [Op.ne]: deviceId } // Все кроме текущей
                    }
                }
            );
            
            res.json({
                success: true,
                message: 'Все другие сессии завершены'
            });

        } catch (error) {
            console.error('❌ Ошибка завершения всех сессий:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка завершения сессий: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    // 🚪 ВЫХОД (завершение текущей сессии)
    async logout(req, res) {
        try {
            const { userId, deviceId } = req;
            
            const session = await DeviceSession.findOne({
                where: { userId, deviceId, isActive: true }
            });
            
            if (session) {
                await session.deactivate();
            }
            
            res.json({
                success: true,
                message: 'Вы вышли из системы'
            });

        } catch (error) {
            console.error('❌ Ошибка выхода:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка выхода: ' + error.message
            });
        }
    }

async register(req, res) {
    const client = await db.getClient();
    
    try {
        await client.query('BEGIN'); // Начало транзакции
        
        const { phone, displayName, username, role = 'user' } = req.body;
        console.log('🆕 Регистрация (с транзакцией):', { phone, username });

        // 1. Проверка телефона
        const phoneCheck = await client.query(
            'SELECT phone FROM users WHERE phone = $1 FOR UPDATE',
            [phone]
        );
        
        if (phoneCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false,
                error: 'Пользователь с таким телефоном уже существует' 
            });
        }

        // 2. Проверка username (если указан)
        const cleanUsername = username ? username.trim().toLowerCase() : null;
        
        if (cleanUsername) {
            // Проверка формата
            const usernameRegex = /^[a-zA-Z0-9_]+$/;
            if (cleanUsername.length < 3 || !usernameRegex.test(cleanUsername)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false,
                    error: 'Username должен быть минимум 3 символа и содержать только буквы, цифры и подчеркивание' 
                });
            }

            // Проверка в БД с блокировкой
            const usernameCheck = await client.query(
                'SELECT username FROM users WHERE LOWER(username) = LOWER($1) FOR UPDATE',
                [cleanUsername]
            );
            
            if (usernameCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false,
                    error: `Username @${cleanUsername} уже занят` 
                });
            }
        }

        // 3. Создание пользователя
        const timestamp = Date.now();
        const userId = 'user_' + timestamp;
        const finalUsername = cleanUsername || phone;
        const finalDisplayName = displayName || "User " + phone.slice(-4);

        const result = await client.query(
            `INSERT INTO users (
                user_id, phone, username, display_name, 
                role, is_premium, is_banned, warnings, auth_level,
                status, last_seen
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                userId, 
                phone,
                finalUsername,
                finalDisplayName,
                role,
                false,
                false,
                0,
                'sms_only',
                'offline',
                Date.now()
            ]
        );

        const newUser = result.rows[0];
        
        // 4. Создание security записи
        await UserSecurity.createOrUpdate(newUser.user_id);
        
        await client.query('COMMIT'); // Фиксация транзакции
        
        console.log('✅ Пользователь зарегистрирован:', { 
            id: newUser.user_id, 
            username: newUser.username 
        });

        const tempToken = jwt.sign(
            { 
                userId: newUser.user_id,
                type: 'registration',
                phone: newUser.phone
            },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(201).json({
            success: true,
            message: 'Пользователь успешно зарегистрирован',
            tempToken: tempToken,
            user: {
                id: newUser.user_id,
                phone: newUser.phone,
                username: newUser.username,
                displayName: newUser.display_name,
                role: newUser.role,
                is_premium: newUser.is_premium,
                authLevel: newUser.auth_level
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка регистрации:', error);
        
        // Обработка ошибки UNIQUE constraint
        if (error.code === '23505') {
            const constraint = error.constraint || '';
            
            if (constraint.includes('username')) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Этот username уже занят' 
                });
            }
            
            if (constraint.includes('phone')) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Этот телефон уже зарегистрирован' 
                });
            }
        }
        
        res.status(500).json({ 
            success: false,
            error: 'Ошибка сервера: ' + error.message 
        });
    } finally {
        client.release();
    }
}

    async verifyCodeAndLogin(req, res) {
        const client = await db.getClient();
        try {
            console.log('🔐 === НАЧАЛО ЛОГИНА ===');
            const { phone, code, type = 'sms' } = req.body;
            console.log('📱 Данные:', { phone, code, type });

            if (!phone || !code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон и код обязательны' 
                });
            }

            console.log('🔍 Поиск кода для:', phone);
            const verificationCode = await VerificationCode.findOne({
                phone: phone, 
                code: code, 
                type: type
            });

            if (!verificationCode) {
                console.log('❌ Код не найден или истек');
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код подтверждения' 
                });
            }

            if (verificationCode.is_used) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Код уже использован' 
                });
            }

            if (new Date() > verificationCode.expires_at) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Код истек' 
                });
            }

            await VerificationCode.markAsUsed(verificationCode.id);

            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            await client.query(
                'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
                ['online', Date.now(), user.user_id]
            );

            console.log('🔑 Генерация токена с JWT_SECRET...');
            console.log('🔑 JWT_SECRET длина:', JWT_SECRET.length);
            
            const token = jwt.sign(
                { 
                    userId: user.user_id, 
                    role: user.role,
                    phone: user.phone
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            console.log('✅ Логин успешен:', user.user_id);
            console.log('✅ Токен сгенерирован, длина:', token.length);

            res.json({
                success: true,
                token: token,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    is_premium: user.is_premium,
                    status: user.status
                },
                security: {
                    twoFAEnabled: securitySettings?.two_fa_enabled || false,
                    codeWordEnabled: securitySettings?.code_word_enabled || false,
                    securityLevel: securitySettings?.security_level || 'low'
                }
            });

        } catch (error) {
            console.error('❌ Ошибка входа:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка входа: ' + error.message 
            });
        } finally {
            client.release();
        }
    }

    async verify2FACode(req, res) {
        try {
            const { userId, code } = req.body;
            console.log('🔐 Проверка 2FA:', { userId, code });

            if (!userId || !code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'ID пользователя и код обязательны' 
                });
            }

            const securitySettings = await UserSecurity.findByUserId(userId);

            if (!securitySettings || !securitySettings.two_fa_enabled) {
                return res.status(400).json({ 
                    success: false,
                    error: '2FA не включена для этого пользователя' 
                });
            }

            const isValid2FACode = await this.validate2FACode(securitySettings.two_fa_secret, code);

            if (!isValid2FACode) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код 2FA' 
                });
            }

            const operationToken = jwt.sign(
                { 
                    userId: userId,
                    type: '2fa_verified',
                    verifiedAt: new Date()
                },
                JWT_SECRET,
                { expiresIn: '5m' }
            );

            console.log('✅ 2FA проверка пройдена:', userId);

            res.json({
                success: true,
                operationToken: operationToken,
                message: '2FA проверка пройдена'
            });

        } catch (error) {
            console.error('❌ Ошибка проверки 2FA:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка проверки 2FA: ' + error.message 
            });
        }
    }

    async validate2FACode(secret, code) {
        try {
            const speakeasy = require('speakeasy');
            return speakeasy.totp.verify({
                secret: secret,
                encoding: 'base32',
                token: code,
                window: 2
            });
        } catch (error) {
            console.error('Ошибка валидации 2FA:', error);
            return /^\d{6}$/.test(code);
        }
    }

    async getAuthRequirements(req, res) {
        try {
            const { phone } = req.params;
            console.log('🔍 Требования аутентификации для:', phone);

            const userResult = await db.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            let requirements = ['sms'];
            
            if (securitySettings?.two_fa_enabled) {
                requirements.push('2fa');
            }

            if (user.role === 'admin' || user.role === 'super_admin') {
                requirements.push('password');
            }

            if (securitySettings?.code_word_enabled) {
                requirements.push('code_word');
            }

            res.json({
                success: true,
                role: user.role,
                requirements: requirements,
                securityLevel: securitySettings?.security_level || 'low',
                message: `Требуется ${requirements.join(', ')} аутентификация`
            });

        } catch (error) {
            console.error('❌ Ошибка получения требований:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    async getUserById(req, res) {   
        const client = await db.getClient();
        try {
            const { userId } = req.params;
            const userResult = await client.query(
                'SELECT * FROM users WHERE user_id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            res.json({
                success: true,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    status: user.status,
                    authLevel: user.auth_level,
                    is_premium: user.is_premium,
                    is_banned: user.is_banned,
                    warnings: user.warnings,
                    last_seen: user.last_seen
                },
                security: securitySettings ? {
                    twoFAEnabled: securitySettings.two_fa_enabled,
                    codeWordEnabled: securitySettings.code_word_enabled,
                    securityLevel: securitySettings.security_level
                } : null
            });

        } catch (error) {
            console.error('❌ Ошибка получения пользователя:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        } finally {
            client.release();
        }
    }

    async cleanExpiredCodes(req, res) {
        try {
            const deletedCount = await VerificationCode.cleanExpiredCodes();
            
            res.json({
                success: true,
                message: `Удалено ${deletedCount} просроченных кодов`,
                deletedCount: deletedCount
            });

        } catch (error) {
            console.error('❌ Ошибка очистки кодов:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }
}

module.exports = new AuthController();
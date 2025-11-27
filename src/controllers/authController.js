const db = require('../config/database');
const jwt = require('jsonwebtoken');

class AuthController {
    async register(req, res) {
        const client = await db.getClient();
        try {
            const { phone, role, displayName, username, is_premium, auth_level } = req.body;

            console.log('🆕 NEW CONTROLLER - Registration:', req.body);

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            // Проверяем существующего пользователя
            const existingUser = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Пользователь с таким телефоном уже существует' 
                });
            }

            // Автогенерация данных если не указаны
            const timestamp = Date.now();
            const userId = 'user_' + timestamp;
            const generatedUsername = username || "user_" + timestamp;
            const generatedDisplayName = displayName || "User " + phone.slice(-4);
            const userRole = role || 'user';
            const premiumStatus = is_premium || false;
            const authLevel = auth_level || 'sms_only';

            // Сохраняем в PostgreSQL
            const result = await client.query(
                `INSERT INTO users (
                    user_id, phone, username, display_name, 
                    role, is_premium, is_banned, warnings, auth_level
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [
                    userId, 
                    phone, 
                    generatedUsername, 
                    generatedDisplayName,
                    userRole,           // Используем роль из запроса
                    premiumStatus,      // Используем премиум статус из запроса
                    false,              // is_banned
                    0,                  // warnings
                    authLevel           // Используем уровень авторизации из запроса
                ]
            );

            const newUser = result.rows[0];
            console.log('✅ User registered in PostgreSQL:', { 
                id: newUser.user_id, 
                phone: newUser.phone, 
                role: newUser.role,
                is_premium: newUser.is_premium 
            });

            const token = jwt.sign(
                { 
                    userId: newUser.user_id, 
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
            console.error('❌ Registration error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка сервера при регистрации: ' + error.message 
            });
        } finally {
            client.release();
        }
    }

    async multiLevelLogin(req, res) {
        const client = await db.getClient();
        try {
            const { phone, smsCode } = req.body;
            
            console.log('🔐 Multi-level login attempt:', { phone });

            // Находим пользователя
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

            // Упрощенная проверка SMS (всегда true для теста)
            const isSMSValid = true;
            if (!isSMSValid) {
                return res.status(401).json({ 
                    success: false,
                    error: 'Неверный SMS код' 
                });
            }

            // Обновляем статус
            await client.query(
                'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
                ['online', Date.now(), user.user_id]
            );

            const token = jwt.sign(
                { 
                    userId: user.user_id, 
                    role: user.role
                },
                process.env.JWT_SECRET || 'fallback-secret',
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    is_premium: user.is_premium,
                    status: user.status
                }
            });

        } catch (error) {
            console.error('❌ Multi-level login error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        } finally {
            client.release();
        }
    }

    async getAuthRequirements(req, res) {
        const client = await db.getClient();
        try {
            const { phone } = req.params;
            
            console.log('🔍 Getting auth requirements for:', phone);

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

            // Определяем требования в зависимости от роли
            let requirements = ['sms'];
            if (user.role === 'admin' || user.role === 'super_admin') {
                requirements.push('2fa', 'biometric');
            }

            res.json({
                success: true,
                role: user.role,
                requirements: requirements,
                message: `Требуется ${requirements.join(', ')} аутентификация`
            });

        } catch (error) {
            console.error('❌ Get auth requirements error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        } finally {
            client.release();
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
                }
            });

        } catch (error) {
            console.error('❌ Get user by ID error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        } finally {
            client.release();
        }
    }

    async updateProfile(req, res) {
        const client = await db.getClient();
        try {
            const { userId } = req.params;
            const { username, displayName, role, is_premium, auth_level } = req.body;

            // Проверяем существует ли пользователь
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

            const currentUser = userResult.rows[0];

            // Если указан username, проверяем что он уникальный
            if (username && username !== currentUser.username) {
                const existingUsername = await client.query(
                    'SELECT * FROM users WHERE username = $1 AND user_id != $2',
                    [username, userId]
                );

                if (existingUsername.rows.length > 0) {
                    return res.status(400).json({ 
                        success: false,
                        error: 'Этот username уже занят' 
                    });
                }
            }

            // Обновляем профиль
            const updateFields = [];
            const updateValues = [];
            let paramCount = 1;

            if (username) {
                updateFields.push(`username = $${paramCount}`);
                updateValues.push(username);
                paramCount++;
            }

            if (displayName) {
                updateFields.push(`display_name = $${paramCount}`);
                updateValues.push(displayName);
                paramCount++;
            }

            if (role) {
                updateFields.push(`role = $${paramCount}`);
                updateValues.push(role);
                paramCount++;
            }

            if (is_premium !== undefined) {
                updateFields.push(`is_premium = $${paramCount}`);
                updateValues.push(is_premium);
                paramCount++;
            }

            if (auth_level) {
                updateFields.push(`auth_level = $${paramCount}`);
                updateValues.push(auth_level);
                paramCount++;
            }

            if (updateFields.length === 0) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Нет данных для обновления' 
                });
            }

            updateValues.push(userId);

            const updateQuery = `
                UPDATE users 
                SET ${updateFields.join(', ')} 
                WHERE user_id = $${paramCount} 
                RETURNING *
            `;

            const result = await client.query(updateQuery, updateValues);
            const updatedUser = result.rows[0];

            res.json({
                success: true,
                message: 'Профиль обновлен',
                user: {
                    id: updatedUser.user_id,
                    phone: updatedUser.phone,
                    username: updatedUser.username,
                    displayName: updatedUser.display_name,
                    role: updatedUser.role,
                    is_premium: updatedUser.is_premium,
                    authLevel: updatedUser.auth_level
                }
            });

        } catch (error) {
            console.error('❌ Update profile error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        } finally {
            client.release();
        }
    }

    // Новый метод для получения всех пользователей с фильтрацией
    async getUsers(req, res) {
        const client = await db.getClient();
        try {
            const { role, is_premium, limit = 100 } = req.query;
            
            let query = 'SELECT * FROM users';
            const queryParams = [];
            let whereConditions = [];
            let paramCount = 1;

            if (role) {
                whereConditions.push(`role = $${paramCount}`);
                queryParams.push(role);
                paramCount++;
            }

            if (is_premium !== undefined) {
                whereConditions.push(`is_premium = $${paramCount}`);
                queryParams.push(is_premium === 'true');
                paramCount++;
            }

            if (whereConditions.length > 0) {
                query += ' WHERE ' + whereConditions.join(' AND ');
            }

            query += ' ORDER BY user_id LIMIT $' + paramCount;
            queryParams.push(parseInt(limit));

            const result = await client.query(query, queryParams);

            res.json({
                success: true,
                count: result.rows.length,
                users: result.rows
            });

        } catch (error) {
            console.error('❌ Get users error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new AuthController();
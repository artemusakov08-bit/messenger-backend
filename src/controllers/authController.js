const pool = require('../config/database'); // или путь к твоему pool
const jwt = require('jsonwebtoken');

class AuthController {
    async register(req, res) {
        const client = await pool.connect();
        try {
            const { phone } = req.body;

            console.log('🆕 NEW CONTROLLER - Registration:', { phone });

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

            // Автогенерация данных
            const timestamp = Date.now();
            const userId = 'user_' + timestamp;
            const username = "user_" + timestamp;
            const displayName = "User " + phone.slice(-4);

            // Сохраняем в PostgreSQL
            const result = await client.query(
                `INSERT INTO users (
                    user_id, phone, username, display_name, 
                    role, is_premium, is_banned, warnings, auth_level
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [
                    userId, 
                    phone, 
                    username, 
                    displayName,
                    'user',     // role
                    false,      // is_premium
                    false,      // is_banned
                    0,          // warnings
                    'sms_only'  // auth_level
                ]
            );

            const newUser = result.rows[0];
            console.log('✅ User registered in PostgreSQL:', newUser.user_id);

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
        const client = await pool.connect();
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
                    role: user.role
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
        const client = await pool.connect();
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

            res.json({
                success: true,
                role: user.role,
                requirements: ['sms'], // Для обычных пользователей только SMS
                message: 'Требуется SMS аутентификация'
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

    // Дополнительный метод для получения пользователя по ID
    async getUserById(req, res) {
        const client = await pool.connect();
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
                    authLevel: user.auth_level
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

    // Метод для обновления профиля
    async updateProfile(req, res) {
        const client = await pool.connect();
        try {
            const { userId } = req.params;
            const { username, displayName } = req.body;

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

            // Если указан username, проверяем что он уникальный
            if (username) {
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
                    role: updatedUser.role
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
}

module.exports = new AuthController();
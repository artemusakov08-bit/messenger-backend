const pool = require('../config/database');

class CallController {
    // Начать звонок
    async startCall(req, res) {
        try {
            const { fromUserId, toUserId, callType = 'voice' } = req.body;
            
            console.log('📞 Starting call:', { fromUserId, toUserId, callType });

            // Проверяем существование пользователей
            const fromUser = await pool.query(
                'SELECT * FROM users WHERE user_id = $1',
                [fromUserId]
            );
            
            const toUser = await pool.query(
                'SELECT * FROM users WHERE user_id = $1',
                [toUserId]
            );

            if (fromUser.rows.length === 0 || toUser.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const callId = 'call_' + Date.now();
            
            const result = await pool.query(
                `INSERT INTO calls (id, from_user_id, to_user_id, call_type, status, created_at) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [callId, fromUserId, toUserId, callType, 'initiated', new Date()]
            );

            const call = result.rows[0];
            console.log('✅ Call started successfully:', callId);
            
            res.json({
                success: true,
                callId: call.id,
                call: call
            });

        } catch (error) {
            console.error('❌ Error starting call:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка начала звонка: ' + error.message 
            });
        }
    }

    // Получить историю звонков
    async getCallHistory(req, res) {
        try {
            const { userId } = req.params;
            
            console.log('📞 Loading call history for user:', userId);

            const result = await pool.query(
                `SELECT c.*, 
                        u1.display_name as from_user_name,
                        u2.display_name as to_user_name
                 FROM calls c
                 LEFT JOIN users u1 ON c.from_user_id = u1.user_id
                 LEFT JOIN users u2 ON c.to_user_id = u2.user_id
                 WHERE c.from_user_id = $1 OR c.to_user_id = $1 
                 ORDER BY c.created_at DESC 
                 LIMIT 50`,
                [userId]
            );

            console.log('✅ Call history loaded:', result.rows.length, 'calls');
            
            res.json(result.rows);

        } catch (error) {
            console.error('❌ Error loading call history:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка загрузки истории звонков: ' + error.message 
            });
        }
    }

    // Завершить звонок
    async endCall(req, res) {
        try {
            const { callId, duration = 0 } = req.body;
            
            console.log('📞 Ending call:', { callId, duration });

            const result = await pool.query(
                `UPDATE calls 
                 SET status = 'ended', duration = $1, ended_at = $2 
                 WHERE id = $3 RETURNING *`,
                [duration, new Date(), callId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Звонок не найден' 
                });
            }

            const call = result.rows[0];
            console.log('✅ Call ended successfully:', callId);
            
            res.json({
                success: true,
                call: call
            });

        } catch (error) {
            console.error('❌ Error ending call:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка завершения звонка: ' + error.message 
            });
        }
    }

    // Получить информацию о звонке
    async getCallDetails(req, res) {
        try {
            const { callId } = req.params;
            
            console.log('📞 Getting call details:', callId);

            const result = await pool.query(
                `SELECT c.*, 
                        u1.display_name as from_user_name,
                        u2.display_name as to_user_name
                 FROM calls c
                 LEFT JOIN users u1 ON c.from_user_id = u1.user_id
                 LEFT JOIN users u2 ON c.to_user_id = u2.user_id
                 WHERE c.id = $1`,
                [callId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Звонок не найден' 
                });
            }

            console.log('✅ Call details loaded');
            
            res.json(result.rows[0]);

        } catch (error) {
            console.error('❌ Error getting call details:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка получения информации о звонке: ' + error.message 
            });
        }
    }
}

module.exports = new CallController();
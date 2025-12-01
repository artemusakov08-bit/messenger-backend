const express = require('express');
const router = express.Router();
const callController = require('../controllers/callController');

// Начать звонок
router.post('/start', (req, res) => {
    callController.startCall(req, res);
});

// Завершить звонок
router.post('/end', (req, res) => {
    callController.endCall(req, res);
});

// Получить историю звонков
router.get('/history/:userId', (req, res) => {
    callController.getCallHistory(req, res);
});

// Получить информацию о звонке
router.get('/:callId', (req, res) => {
    callController.getCallDetails(req, res);
});

// Принять звонок
router.post('/:callId/accept', async (req, res) => {
    try {
        const { callId } = req.params;
        
        console.log('✅ Accepting call:', callId);

        const pool = require('../config/database');
        const result = await pool.query(
            `UPDATE calls SET status = 'active' WHERE id = $1 RETURNING *`,
            [callId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Звонок не найден' 
            });
        }

        const call = result.rows[0];
        
        console.log('✅ Call accepted:', callId);

        res.json({
            success: true,
            call: call
        });

    } catch (error) {
        console.error('❌ Accept call error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка принятия звонка' 
        });
    }
});

// Отклонить звонок
router.post('/:callId/reject', async (req, res) => {
    try {
        const { callId } = req.params;
        
        console.log('❌ Rejecting call:', callId);

        const pool = require('../config/database');
        const result = await pool.query(
            `UPDATE calls SET status = 'rejected' WHERE id = $1 RETURNING *`,
            [callId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Звонок не найден' 
            });
        }

        const call = result.rows[0];
        
        console.log('✅ Call rejected:', callId);

        res.json({
            success: true,
            call: call
        });

    } catch (error) {
        console.error('❌ Reject call error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка отклонения звонка' 
        });
    }
});

module.exports = router;
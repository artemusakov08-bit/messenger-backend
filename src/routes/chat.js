const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const messageController = require('../controllers/messageController');

// Получить чаты пользователя
router.get('/user/:userId', (req, res) => {
    chatController.getUserChats(req, res);
});

// Создать приватный чат
router.post('/private', (req, res) => {
    chatController.createPrivateChat(req, res);
});

// Получить информацию о чате
router.get('/:chatId', (req, res) => {
    chatController.getChat(req, res);
});

// Получить сообщения чата
router.get('/:chatId/messages', (req, res) => {
    messageController.getChatMessages(req, res);
});

// Отправить сообщение
router.post('/:chatId/messages', (req, res) => {
    messageController.sendMessage(req, res);
});

// Поиск пользователя для чата
router.get('/find-user/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        
        console.log('🔍 Finding user for chat by phone:', phone);

        const pool = require('../config/database');
        const result = await pool.query(
            'SELECT user_id, display_name, phone, status FROM users WHERE phone = $1',
            [phone]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Пользователь не найден' 
            });
        }
        
        const user = result.rows[0];
        
        res.json({
            success: true,
            user: {
                id: user.user_id,
                displayName: user.display_name,
                phone: user.phone,
                status: user.status
            }
        });
        
    } catch (error) {
        console.error('❌ Error finding user for chat:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка поиска пользователя' 
        });
    }
});

module.exports = router;
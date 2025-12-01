const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Отправить сообщение
router.post('/send', (req, res) => {
    messageController.sendMessage(req, res);
});

// Получить сообщения чата
router.get('/chat/:chatId', (req, res) => {
    messageController.getChatMessages(req, res);
});

// Получить последние сообщения пользователя
router.get('/user/:userId/recent', (req, res) => {
    messageController.getRecentMessages(req, res);
});

module.exports = router;
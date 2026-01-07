const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const authMiddleware = require('../middleware/authMiddleware');
const validationMiddleware = require('../middleware/validationMiddleware');

// Все роуты требуют аутентификации
router.use(authMiddleware.authenticate);

// 📤 Отправка сообщения
router.post('/send',
    [
        validationMiddleware.sanitizeInput(),
        validationMiddleware.validateDataSize(5)
    ],
    messageController.sendMessage
);

// 📥 Получение сообщений чата
router.get('/chat/:chatId',
    messageController.getChatMessages
);

// 👁️ Отметка прочтения
router.post('/read',
    [
        validationMiddleware.sanitizeInput()
    ],
    messageController.markMessageAsRead
);

// ✏️ Редактирование сообщения
router.put('/edit/:messageId',
    [
        validationMiddleware.sanitizeInput()
    ],
    messageController.editMessage
);

// 🗑️ Удаление сообщения
router.delete('/delete/:messageId',
    [
        validationMiddleware.sanitizeInput()
    ],
    messageController.deleteMessage
);

// 💬 Статус печатания
router.post('/typing',
    [
        validationMiddleware.sanitizeInput()
    ],
    messageController.setTypingStatus
);

// 📦 Пропущенные сообщения
router.get('/missed',
    [
        validationMiddleware.sanitizeInput()
    ],
    messageController.getMissedMessages
);

module.exports = router;
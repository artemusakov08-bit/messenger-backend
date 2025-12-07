const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const messageController = require('../controllers/messageController');
const authMiddleware = require('../middleware/authMiddleware');

// 🔐 ВСЕ РОУТЫ ТРЕБУЮТ АВТОРИЗАЦИИ
router.use(authMiddleware.authenticate);

// 📱 ПОЛУЧИТЬ ЧАТЫ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
router.get('/my-chats', async (req, res) => {
    try {
        await chatController.getUserChats(req, res);
    } catch (error) {
        console.error('❌ Route error getting user chats:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения чатов'
        });
    }
});

// 👥 ПОЛУЧИТЬ ГРУППЫ
router.get('/groups', async (req, res) => {
    try {
        await chatController.getGroups(req, res);
    } catch (error) {
        console.error('❌ Route error getting groups:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения групп'
        });
    }
});

// 🔍 ПОИСК ГРУПП
router.get('/groups/search', async (req, res) => {
    try {
        await chatController.searchGroups(req, res);
    } catch (error) {
        console.error('❌ Route error searching groups:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска групп'
        });
    }
});

// 💬 СОЗДАТЬ ПРИВАТНЫЙ ЧАТ
router.post('/private', async (req, res) => {
    try {
        await chatController.createPrivateChat(req, res);
    } catch (error) {
        console.error('❌ Route error creating private chat:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания чата'
        });
    }
});

// ℹ️ ПОЛУЧИТЬ ИНФОРМАЦИЮ О ЧАТЕ
router.get('/:chatId', async (req, res) => {
    try {
        await chatController.getChat(req, res);
    } catch (error) {
        console.error('❌ Route error getting chat:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о чате'
        });
    }
});

// 💌 ПОЛУЧИТЬ СООБЩЕНИЯ ЧАТА
router.get('/:chatId/messages', async (req, res) => {
    try {
        await messageController.getChatMessages(req, res);
    } catch (error) {
        console.error('❌ Route error getting chat messages:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения сообщений'
        });
    }
});

// 📤 ОТПРАВИТЬ СООБЩЕНИЕ
router.post('/:chatId/messages', async (req, res) => {
    try {
        await messageController.sendMessage(req, res);
    } catch (error) {
        console.error('❌ Route error sending message:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// 👤 ПОЛУЧИТЬ ИНФОРМАЦИЮ О ГРУППЕ
router.get('/group/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const pool = require('../config/database');
        
        const groupResult = await pool.query(
            `SELECT g.*, 
                    u.display_name as created_by_name,
                    COUNT(gm.user_id) as member_count
             FROM groups g
             LEFT JOIN users u ON g.created_by = u.user_id
             LEFT JOIN group_members gm ON g.id = gm.group_id
             WHERE g.id = $1
             GROUP BY g.id, u.display_name`,
            [groupId]
        );
        
        if (groupResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }
        
        // Получаем участников группы
        const membersResult = await pool.query(
            `SELECT u.user_id, u.display_name, u.username, u.profile_image, gm.role, gm.joined_at
             FROM group_members gm
             JOIN users u ON gm.user_id = u.user_id
             WHERE gm.group_id = $1
             ORDER BY 
                 CASE gm.role 
                     WHEN 'admin' THEN 1
                     WHEN 'moderator' THEN 2
                     ELSE 3 
                 END,
                 gm.joined_at`,
            [groupId]
        );
        
        const group = groupResult.rows[0];
        group.members = membersResult.rows;
        group.member_count = parseInt(group.member_count);
        
        res.json({
            success: true,
            group: group
        });
        
    } catch (error) {
        console.error('❌ Error getting group:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения группы'
        });
    }
});

// 🔍 ПОИСК ПОЛЬЗОВАТЕЛЯ ДЛЯ ЧАТА
router.get('/find-user/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const currentUserId = req.user.user_id; // Текущий авторизованный пользователь
        
        console.log('🔍 Finding user for chat by phone:', phone);

        const pool = require('../config/database');
        const result = await pool.query(
            'SELECT user_id, display_name, phone, status, profile_image FROM users WHERE phone = $1 AND user_id != $2',
            [phone, currentUserId] // Исключаем текущего пользователя
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
                status: user.status,
                profileImage: user.profile_image
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
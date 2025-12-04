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

router.get('/groups', (req, res) => {
    chatController.getGroups(req, res);
});

// Поиск групп
router.get('/groups/search', (req, res) => {
    chatController.searchGroups(req, res);
});

// Получить информацию о группе
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
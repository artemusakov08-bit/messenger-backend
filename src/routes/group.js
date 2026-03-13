const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const authMiddleware = require('../middleware/authMiddleware');

// Все роуты требуют аутентификации
router.use(authMiddleware.authenticate);

// 📋 Получить группы пользователя
router.get('/', groupController.getUserGroups);

// 🔍 Поиск групп
router.get('/search', groupController.searchGroups);

// ℹ️ Получить информацию о группе
router.get('/:groupId', groupController.getGroupInfo);

// ➕ Создать группу
router.post('/', groupController.createGroup);

// ✏️ Обновить группу
router.put('/:groupId', groupController.updateGroup);

// 👥 Добавить участников
router.post('/:groupId/members', groupController.addMembers);

// ➖ Удалить участника
router.delete('/:groupId/members/:memberId', groupController.removeMember);

// 🚪 Покинуть группу
router.post('/:groupId/leave', groupController.leaveGroup);

module.exports = router;
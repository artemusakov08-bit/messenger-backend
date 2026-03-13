const pool = require('../config/database');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const Message = require('../models/Message');

let chatSocketInstance = null;

const setChatSocket = (socketInstance) => {
    chatSocketInstance = socketInstance;
};

// Создать группу
const createGroup = async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { name, description, members = [] } = req.body;
        const creatorId = req.user.userId;
        
        console.log(`👥 Создание группы "${name}" пользователем ${creatorId}`);

        if (!name || name.trim().length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Название группы должно быть минимум 3 символа'
            });
        }

        // 1. Создаем группу
        const group = await Group.create({
            name,
            description,
            createdBy: creatorId
        });

        // 2. Добавляем создателя как админа
        await GroupMember.add(group.id, creatorId, 'admin');

        // 3. Добавляем остальных участников (уникальные, не включая создателя)
        const uniqueMembers = [...new Set(members.filter(id => id !== creatorId))];
        for (const memberId of uniqueMembers) {
            await GroupMember.add(group.id, memberId, 'member');
        }

        // 4. Создаем чат группы
        const chatId = group.id;
        await client.query(
            `INSERT INTO chats (id, name, type, timestamp, last_message)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [chatId, name, 'group', Date.now(), `Группа "${name}" создана`]
        );

        await client.query('COMMIT');

        // 5. Получаем полную информацию
        const fullGroup = await Group.findById(group.id);
        const groupMembers = await GroupMember.getMembers(group.id);
        fullGroup.members = groupMembers;

        // 6. Уведомляем всех участников через WebSocket
        if (chatSocketInstance) {
            const allMembers = [creatorId, ...uniqueMembers];
            allMembers.forEach(memberId => {
                chatSocketInstance.sendToUser(memberId, {
                    type: 'group_created',
                    group: fullGroup,
                    timestamp: Date.now()
                });
            });
        }

        res.status(201).json({
            success: true,
            group: fullGroup
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error creating group:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания группы: ' + error.message
        });
    } finally {
        client.release();
    }
};

// Получить группы пользователя
const getUserGroups = async (req, res) => {
    try {
        const userId = req.user.userId;
        
        console.log(`👥 Getting groups for user ${userId}`);
        
        const groups = await Group.getUserGroups(userId);
        
        // Для каждой группы получаем участников
        const groupsWithMembers = await Promise.all(
            groups.map(async (group) => {
                const members = await GroupMember.getMembers(group.id);
                return {
                    ...group,
                    members,
                    member_count: parseInt(group.member_count)
                };
            })
        );

        res.json({
            success: true,
            groups: groupsWithMembers
        });

    } catch (error) {
        console.error('❌ Error getting user groups:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения групп'
        });
    }
};

// Получить информацию о группе
const getGroupInfo = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.userId;
        
        console.log(`ℹ️ Getting group info for ${groupId} by user ${userId}`);

        // Проверяем, состоит ли пользователь в группе
        const isMember = await GroupMember.isMember(groupId, userId);
        
        const group = await Group.findById(groupId);
        
        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }

        const members = await GroupMember.getMembers(groupId);
        
        // Если пользователь не в группе, показываем только публичную информацию
        if (!isMember) {
            return res.json({
                success: true,
                group: {
                    id: group.id,
                    name: group.name,
                    description: group.description,
                    avatar_url: group.avatar_url,
                    member_count: group.member_count,
                    created_at: group.created_at,
                    is_private: group.is_private,
                    isMember: false
                },
                members: members.slice(0, 5) // Только первые 5 участников для превью
            });
        }

        // Полная информация для участников
        res.json({
            success: true,
            group: {
                ...group,
                member_count: parseInt(group.member_count)
            },
            members,
            isMember: true
        });

    } catch (error) {
        console.error('❌ Error getting group info:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о группе'
        });
    }
};

// Добавить участников в группу
const addMembers = async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { groupId } = req.params;
        const { members } = req.body;
        const userId = req.user.userId;

        console.log(`➕ Adding members to group ${groupId} by user ${userId}`);

        // Проверяем, является ли пользователь админом
        const isAdmin = await GroupMember.isAdmin(groupId, userId);
        
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Только администраторы могут добавлять участников'
            });
        }

        const addedMembers = [];
        const alreadyMembers = [];

        for (const memberId of members) {
            const isMember = await GroupMember.isMember(groupId, memberId);
            
            if (isMember) {
                alreadyMembers.push(memberId);
            } else {
                const newMember = await GroupMember.add(groupId, memberId, 'member');
                addedMembers.push(newMember);
            }
        }

        await client.query('COMMIT');

        // Уведомляем новых участников
        if (chatSocketInstance && addedMembers.length > 0) {
            const group = await Group.findById(groupId);
            addedMembers.forEach(member => {
                chatSocketInstance.sendToUser(member.user_id, {
                    type: 'added_to_group',
                    group,
                    timestamp: Date.now()
                });
            });
        }

        res.json({
            success: true,
            added: addedMembers.length,
            alreadyMembers: alreadyMembers.length
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error adding members:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка добавления участников'
        });
    } finally {
        client.release();
    }
};

// Удалить участника из группы
const removeMember = async (req, res) => {
    try {
        const { groupId, memberId } = req.params;
        const userId = req.user.userId;

        console.log(`➖ Removing member ${memberId} from group ${groupId} by user ${userId}`);

        // Проверяем, является ли пользователь админом
        const isAdmin = await GroupMember.isAdmin(groupId, userId);
        
        if (!isAdmin && userId !== memberId) {
            return res.status(403).json({
                success: false,
                error: 'Недостаточно прав для удаления участника'
            });
        }

        // Проверяем, не последний ли это админ
        if (userId !== memberId) {
            const members = await GroupMember.getMembers(groupId);
            const admins = members.filter(m => m.role === 'admin');
            
            if (admins.length === 1 && admins[0].user_id === memberId) {
                return res.status(400).json({
                    success: false,
                    error: 'Нельзя удалить последнего администратора'
                });
            }
        }

        await GroupMember.remove(groupId, memberId);

        // Уведомляем удаленного участника
        if (chatSocketInstance) {
            chatSocketInstance.sendToUser(memberId, {
                type: 'removed_from_group',
                groupId,
                timestamp: Date.now()
            });
        }

        res.json({
            success: true,
            message: 'Участник удален'
        });

    } catch (error) {
        console.error('❌ Error removing member:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления участника'
        });
    }
};

// Обновить информацию о группе
const updateGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const updates = req.body;
        const userId = req.user.userId;

        console.log(`✏️ Updating group ${groupId} by user ${userId}`);

        // Проверяем, является ли пользователь админом
        const isAdmin = await GroupMember.isAdmin(groupId, userId);
        
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Только администраторы могут изменять группу'
            });
        }

        const updatedGroup = await Group.update(groupId, updates);

        // Обновляем название чата
        if (updates.name) {
            await pool.query(
                'UPDATE chats SET name = $1 WHERE id = $2',
                [updates.name, groupId]
            );
        }

        // Уведомляем всех участников
        if (chatSocketInstance) {
            const members = await GroupMember.getMembers(groupId);
            members.forEach(member => {
                chatSocketInstance.sendToUser(member.user_id, {
                    type: 'group_updated',
                    groupId,
                    updates,
                    timestamp: Date.now()
                });
            });
        }

        res.json({
            success: true,
            group: updatedGroup
        });

    } catch (error) {
        console.error('❌ Error updating group:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления группы'
        });
    }
};

// Покинуть группу
const leaveGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.userId;

        console.log(`🚪 User ${userId} leaving group ${groupId}`);

        // Проверяем, не последний ли это админ
        const members = await GroupMember.getMembers(groupId);
        const admins = members.filter(m => m.role === 'admin');
        
        if (admins.length === 1 && admins[0].user_id === userId) {
            // Если последний админ уходит, назначаем нового
            const otherMembers = members.filter(m => m.user_id !== userId);
            if (otherMembers.length > 0) {
                // Назначаем первого участника админом
                await GroupMember.updateRole(groupId, otherMembers[0].user_id, 'admin');
            }
        }

        await GroupMember.remove(groupId, userId);

        res.json({
            success: true,
            message: 'Вы покинули группу'
        });

    } catch (error) {
        console.error('❌ Error leaving group:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при выходе из группы'
        });
    }
};

// Поиск групп
const searchGroups = async (req, res) => {
    try {
        const { query } = req.query;
        const userId = req.user.userId;

        if (!query || query.length < 2) {
            return res.json({
                success: true,
                groups: []
            });
        }

        console.log(`🔍 Searching groups for "${query}"`);

        const groups = await Group.search(query, userId);

        res.json({
            success: true,
            groups
        });

    } catch (error) {
        console.error('❌ Error searching groups:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска групп'
        });
    }
};

module.exports = {
    createGroup,
    getUserGroups,
    getGroupInfo,
    addMembers,
    removeMember,
    updateGroup,
    leaveGroup,
    searchGroups,
    setChatSocket
};
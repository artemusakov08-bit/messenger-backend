const db = require('../config/database');
const FileUtils = require('../utils/fileUtils');

class UploadController {
    // Загрузка аватара
    async uploadAvatar(req, res) {
        const client = await db.getClient();
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Файл не загружен',
                    code: 'NO_FILE'
                });
            }

            const userId = req.user.userId;
            console.log('📸 Загрузка аватара для пользователя:', userId);

            // Оптимизируем изображение
            const optimizedPath = await FileUtils.optimizeImage(req.file.path, userId);
            const filename = path.basename(optimizedPath);

            // Получаем старый аватар из БД
            const oldAvatarResult = await client.query(
                'SELECT avatar_url FROM users WHERE user_id = $1',
                [userId]
            );

            const oldAvatar = oldAvatarResult.rows[0]?.avatar_url;

            // Обновляем в БД
            await client.query(
                'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2',
                [filename, userId]
            );

            // Удаляем старый аватар если есть
            if (oldAvatar) {
                await FileUtils.deleteFile(oldAvatar);
            }

            // Получаем полный URL для ответа
            const avatarUrl = FileUtils.getAvatarUrl(filename, req);

            res.json({
                success: true,
                message: 'Аватар успешно загружен',
                avatarUrl: avatarUrl,
                filename: filename
            });

        } catch (error) {
            console.error('❌ Ошибка загрузки аватара:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка загрузки файла',
                code: 'UPLOAD_ERROR',
                details: error.message
            });
        } finally {
            client.release();
        }
    }

    // Удаление аватара
    async deleteAvatar(req, res) {
        const client = await db.getClient();
        try {
            const userId = req.user.userId;
            const { filename } = req.params;

            console.log('🗑️ Удаление аватара:', { userId, filename });

            // Проверяем, принадлежит ли файл пользователю
            const userResult = await client.query(
                'SELECT avatar_url FROM users WHERE user_id = $1',
                [userId]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден',
                    code: 'USER_NOT_FOUND'
                });
            }

            const currentAvatar = userResult.rows[0].avatar_url;

            if (currentAvatar !== filename) {
                return res.status(403).json({
                    success: false,
                    error: 'Нет прав на удаление этого файла',
                    code: 'FORBIDDEN'
                });
            }

            // Удаляем файл
            const deleted = await FileUtils.deleteFile(filename);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    error: 'Файл не найден',
                    code: 'FILE_NOT_FOUND'
                });
            }

            // Очищаем поле в БД
            await client.query(
                'UPDATE users SET avatar_url = NULL WHERE user_id = $1',
                [userId]
            );

            res.json({
                success: true,
                message: 'Аватар удален'
            });

        } catch (error) {
            console.error('❌ Ошибка удаления аватара:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка удаления',
                code: 'DELETE_ERROR'
            });
        } finally {
            client.release();
        }
    }

    // Получение аватара по имени файла
    async getAvatar(req, res) {
        try {
            const { filename } = req.params;
            const filepath = path.join(__dirname, '../../uploads/avatars', filename);

            res.sendFile(filepath);
        } catch (error) {
            console.error('❌ Ошибка получения аватара:', error);
            res.status(404).json({
                success: false,
                error: 'Файл не найден'
            });
        }
    }
}

module.exports = new UploadController();
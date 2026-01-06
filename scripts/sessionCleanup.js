const cron = require('node-cron');
const sessionService = require('../src/services/sessionService');
const { RefreshToken, DeviceSession } = require('../src/models');
const { Op } = require('sequelize');

// Очистка каждые 6 часов
cron.schedule('0 */6 * * *', async () => {
  console.log('🧹 Запуск очистки истекших сессий...');
  
  try {
    // 1. Очистка истекших сессий
    const expiredSessions = await DeviceSession.update(
      { isActive: false },
      {
        where: {
          refreshTokenExpiresAt: {
            [Op.lt]: new Date()
          },
          isActive: true
        }
      }
    );
    
    console.log(`✅ Деактивировано истекших сессий: ${expiredSessions[0]}`);
    
    // 2. Очистка истекших refresh токенов
    const expiredTokens = await RefreshToken.update(
      { isRevoked: true, revokedAt: new Date() },
      {
        where: {
          expiresAt: {
            [Op.lt]: new Date()
          },
          isRevoked: false
        }
      }
    );
    
    console.log(`✅ Отозвано истекших refresh токенов: ${expiredTokens[0]}`);
    
    // 3. Очистка кэша Redis
    await sessionService.cleanupExpiredSessions();
    
    console.log('✅ Очистка завершена');
    
  } catch (error) {
    console.error('❌ Ошибка очистки сессий:', error);
  }
});

console.log('⏰ Cron job для очистки сессий запущен (каждые 6 часов)');
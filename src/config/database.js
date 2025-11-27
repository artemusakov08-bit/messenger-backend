const { Pool } = require('pg');

class Database {
    constructor() {
        this.isConnected = false;
        this.pool = null;
    }

    async connect() {
        try {
            const DATABASE_URL = process.env.DATABASE_URL;
            
            if (!DATABASE_URL) {
                throw new Error('DATABASE_URL environment variable is required');
            }

            this.pool = new Pool({
                connectionString: DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { 
                    rejectUnauthorized: false 
                } : false,
                // Дополнительные настройки
                max: 20, // максимальное количество клиентов в пуле
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Тестируем подключение
            const client = await this.pool.connect();
            console.log('✅ PostgreSQL подключена успешно');
            client.release();
            
            this.isConnected = true;
            this.setupEventHandlers();
            
        } catch (error) {
            console.error('❌ Ошибка подключения к PostgreSQL:', error);
            process.exit(1);
        }
    }

    setupEventHandlers() {
        this.pool.on('error', (error) => {
            console.error('PostgreSQL ошибка:', error);
            this.isConnected = false;
        });

        this.pool.on('connect', () => {
            console.log('✅ Новое подключение к PostgreSQL установлено');
        });

        process.on('SIGINT', async () => {
            await this.disconnect();
            console.log('PostgreSQL соединение закрыто');
            process.exit(0);
        });
    }

    async disconnect() {
        if (this.pool && this.isConnected) {
            await this.pool.end();
            this.isConnected = false;
            console.log('PostgreSQL отключена');
        }
    }

    // Метод для выполнения запросов
    async query(text, params) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        return await this.pool.query(text, params);
    }

    // Метод для получения клиента (для транзакций)
    async getClient() {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        return await this.pool.connect();
    }
}

module.exports = new Database();
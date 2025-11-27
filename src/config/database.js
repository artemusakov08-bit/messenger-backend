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

            console.log('🔗 Connecting to PostgreSQL...');
            
            this.pool = new Pool({
                connectionString: DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                },
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
            });

            // Тестируем подключение
            const client = await this.pool.connect();
            console.log('✅ PostgreSQL подключена успешно');
            client.release();
            
            this.isConnected = true;
            this.setupEventHandlers();
            
            return this.pool;
            
        } catch (error) {
            console.error('❌ Ошибка подключения к PostgreSQL:', error.message);
            process.exit(1);
        }
    }

    setupEventHandlers() {
        if (this.pool) {
            this.pool.on('error', (error) => {
                console.error('PostgreSQL pool error:', error);
                this.isConnected = false;
            });
        }
    }

    async query(text, params) {
        if (!this.isConnected || !this.pool) {
            await this.connect();
        }
        return await this.pool.query(text, params);
    }

    async getClient() {
        if (!this.isConnected || !this.pool) {
            await this.connect();
        }
        return await this.pool.connect();
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            console.log('PostgreSQL disconnected');
        }
    }
}

const database = new Database();

module.exports = database;
const { Pool } = require('pg');

class Database {
    constructor() {
        this.pool = null;
        this.init();
    }

    async init() {
        try {
            const DATABASE_URL = process.env.DATABASE_URL;
            
            if (!DATABASE_URL) {
                throw new Error('DATABASE_URL environment variable is required');
            }

            console.log('🔗 Connecting to PostgreSQL...');
            
            this.pool = new Pool({
                connectionString: DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false,
                    require: true
                },
                max: 5,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000,
                query_timeout: 10000,
                statement_timeout: 10000
            });

            const client = await this.pool.connect();
            console.log('✅ PostgreSQL подключена успешно');
            client.release();
            
            this.setupEventHandlers();
            
        } catch (error) {
            console.error('❌ Ошибка подключения к PostgreSQL:', error.message);
            
            // 🔥 ПРОБУЕМ БЕЗ SSL
            console.log('🔄 Пробуем подключиться без SSL...');
            try {
                this.pool = new Pool({
                    connectionString: process.env.DATABASE_URL,
                    ssl: false,
                    max: 3,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 15000,
                });

                const client = await this.pool.connect();
                console.log('✅ PostgreSQL подключена без SSL');
                client.release();
                this.setupEventHandlers();
                
            } catch (sslError) {
                console.error('❌ Ошибка подключения без SSL:', sslError.message);
                throw new Error('Cannot connect to database: ' + sslError.message);
            }
        }
    }

    setupEventHandlers() {
        if (this.pool) {
            this.pool.on('error', (error) => {
                console.error('PostgreSQL pool error:', error);
            });

            this.pool.on('connect', () => {
                console.log('🔗 Новое подключение к БД установлено');
            });
        }
    }

    async query(text, params) {
        if (!this.pool) {
            throw new Error('Database not connected');
        }
        return await this.pool.query(text, params);
    }

    async connect() {
        if (!this.pool) {
            throw new Error('Database not connected');
        }
        return await this.pool.connect();
    }

    async getClient() {
        return await this.connect();
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.end();
            console.log('PostgreSQL disconnected');
        }
    }
}

const database = new Database();
module.exports = database;
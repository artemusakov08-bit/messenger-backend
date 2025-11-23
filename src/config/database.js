const mongoose = require('mongoose');

class Database {
    constructor() {
        this.isConnected = false;
    }

    async connect() {
        try {
            const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/messenger';
            
            await mongoose.connect(MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });

            this.isConnected = true;
            console.log('✅ MongoDB подключена');

            this.setupEventHandlers();
        } catch (error) {
            console.error('❌ Ошибка подключения к MongoDB:', error);
            process.exit(1);
        }
    }

    setupEventHandlers() {
        mongoose.connection.on('error', (error) => {
            console.error('MongoDB ошибка:', error);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB отключена');
            this.isConnected = false;
        });

        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB соединение закрыто');
            process.exit(0);
        });
    }

    async disconnect() {
        if (this.isConnected) {
            await mongoose.connection.close();
            this.isConnected = false;
            console.log('MongoDB отключена');
        }
    }
}

module.exports = new Database();
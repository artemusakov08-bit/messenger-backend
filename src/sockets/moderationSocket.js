const WebSocket = require('ws');

class ModerationSocket {
    constructor(server) {
        this.wss = new WebSocket.Server({ server });
        this.clients = new Map(); // userId -> WebSocket
        
        this.setupConnection();
    }

    setupConnection() {
        this.wss.on('connection', (ws, request) => {
            const userId = this.getUserIdFromRequest(request);
            
            if (userId) {
                this.clients.set(userId, ws);
                console.log(`Client connected: ${userId}`);
            }

            ws.on('message', (data) => {
                this.handleMessage(userId, JSON.parse(data));
            });

            ws.on('close', () => {
                this.clients.delete(userId);
                console.log(`Client disconnected: ${userId}`);
            });
        });
    }

    handleMessage(userId, data) {
        switch (data.type) {
            case 'join_queue':
                this.handleJoinQueue(userId, data);
                break;
            case 'report_update':
                this.broadcastToModerators(data);
                break;
        }
    }

    handleJoinQueue(userId, data) {
        // Модератор присоединяется к очереди жалоб
        this.sendToUser(userId, {
            type: 'queue_joined',
            queue: 'reports'
        });
    }

    sendToUser(userId, message) {
        const client = this.clients.get(userId);
        if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    }

    broadcastToModerators(message) {
        this.clients.forEach((client, userId) => {
            // Отправляем только модераторам и выше
            if (this.isModerator(userId)) {
                client.send(JSON.stringify(message));
            }
        });
    }

    notifyNewReport(report) {
        this.broadcastToModerators({
            type: 'new_report',
            report: report,
            priority: report.priority,
            isPremium: report.isPremium
        });
    }

    isModerator(userId) {
        // Проверка роли пользователя (упрощенно)
        return true; // Заменить на реальную проверку
    }

    getUserIdFromRequest(request) {
        // Извлечение userId из запроса
        return request.headers['user-id'];
    }
}

module.exports = ModerationSocket;
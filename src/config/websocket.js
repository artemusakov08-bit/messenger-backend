const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class WebSocketConfig {
    constructor(server) {
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws',
            verifyClient: this.verifyClient.bind(this)
        });
        
        this.clients = new Map(); // userId -> WebSocket
        this.setupConnection();
    }

    verifyClient(info, callback) {
        // Проверка токена при подключении
        const token = info.req.url.split('token=')[1];
        
        if (!token) {
            callback(false, 401, 'Токен отсутствует');
            return;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            info.req.user = decoded;
            callback(true);
        } catch (error) {
            callback(false, 401, 'Неверный токен');
        }
    }

    setupConnection() {
        this.wss.on('connection', (ws, request) => {
            const userId = request.user.userId;
            const userRole = request.user.role;

            console.log(`WebSocket подключен: ${userId} (${userRole})`);
            
            this.clients.set(userId, ws);
            this.sendToUser(userId, { type: 'connected', message: 'WebSocket подключен' });

            ws.on('message', (data) => {
                this.handleMessage(userId, userRole, data);
            });

            ws.on('close', () => {
                this.clients.delete(userId);
                console.log(`WebSocket отключен: ${userId}`);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket ошибка (${userId}):`, error);
            });
        });
    }

    handleMessage(userId, userRole, data) {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'join_moderation_queue':
                    this.handleJoinModerationQueue(userId, userRole);
                    break;
                case 'subscribe_reports':
                    this.handleSubscribeReports(userId, userRole);
                    break;
                case 'ping':
                    this.sendToUser(userId, { type: 'pong' });
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    }

    handleJoinModerationQueue(userId, userRole) {
        if (!['moderator', 'admin', 'lead', 'super_admin'].includes(userRole)) {
            this.sendToUser(userId, { 
                type: 'error', 
                message: 'Недостаточно прав для модерации' 
            });
            return;
        }

        this.sendToUser(userId, { 
            type: 'queue_joined', 
            queue: 'moderation' 
        });
    }

    sendToUser(userId, message) {
        const client = this.clients.get(userId);
        if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    }

    broadcastToRole(role, message) {
        this.clients.forEach((client, userId) => {
            // Здесь нужно проверять роль пользователя
            // Для простоты отправляем всем модераторам
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }

    notifyNewReport(report) {
        this.broadcastToRole('moderator', {
            type: 'new_report',
            report: report,
            timestamp: new Date().toISOString()
        });
    }

    notifyReportUpdate(reportId, status) {
        this.broadcastToRole('moderator', {
            type: 'report_updated',
            reportId,
            status,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = WebSocketConfig;
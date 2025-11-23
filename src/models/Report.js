const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    reason: { type: String, required: true },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'resolved', 'escalated'],
        default: 'pending'
    },
    assignedModerator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isPremium: { type: Boolean, default: false },
    escalationLevel: { type: Number, default: 0 },
    resolution: String,
    resolvedAt: Date
}, { timestamps: true });

// Индекс для приоритетной очереди
reportSchema.index({ isPremium: -1, priority: -1, createdAt: 1 });

module.exports = mongoose.model('Report', reportSchema);
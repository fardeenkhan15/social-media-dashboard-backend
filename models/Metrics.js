const mongoose = require('mongoose');

const MetricsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  value: { type: String, required: true },
  category: { type: String, required: true }
});

module.exports = mongoose.model('Metrics', MetricsSchema);
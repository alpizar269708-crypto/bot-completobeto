require('dotenv').config();
const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  activatedGroupId: { type: String, default: null },
  ownerJid: { type: String, default: null },
  activeCycleId: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'servicios_config' });

const cycleSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  groupId: { type: String, required: true, index: true },
  startingAmount: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null }
}, { collection: 'servicios_cycles' });

const serviceSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  cycleId: { type: String, required: true, index: true },
  groupId: { type: String, required: true, index: true },
  sourceMessageId: { type: String, required: true, index: true },
  senderJid: { type: String, default: '' },
  amount: { type: Number, required: true },
  name: { type: String, required: true },
  normalizedName: { type: String, required: true, index: true },
  status: { type: String, enum: ['pending', 'paid'], default: 'pending', index: true },
  paidAt: { type: Date, default: null },
  paidByName: { type: String, default: null },
  paymentMethod: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'servicios_items' });

const botMessageSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  jid: { type: String, default: '' },
  kind: { type: String, default: 'bot' },
  textFingerprint: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { collection: 'servicios_bot_messages' });
botMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const promptSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  groupId: { type: String, required: true },
  userJid: { type: String, required: true },
  kind: { type: String, required: true },
  cycleId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { collection: 'servicios_prompts' });
promptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Auth = mongoose.model('ServiciosAuth', new mongoose.Schema({
  _id: { type: String, required: true },
  data: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'servicios_auth' }));

const Config = mongoose.model('ServiciosConfig', configSchema);
const Cycle = mongoose.model('ServiciosCycle', cycleSchema);
const Service = mongoose.model('ServiciosItem', serviceSchema);
const BotMessage = mongoose.model('ServiciosBotMessage', botMessageSchema);
const Prompt = mongoose.model('ServiciosPrompt', promptSchema);

async function connectMongo() {
  if (!process.env.MONGO_URI) throw new Error('Falta MONGO_URI');
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 10
    });
  }

  await Config.findOneAndUpdate(
    { _id: 'global' },
    { $setOnInsert: { _id: 'global', updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  return mongoose.connection;
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = {
  mongoose,
  Auth,
  Config,
  Cycle,
  Service,
  BotMessage,
  Prompt,
  connectMongo,
  id
};

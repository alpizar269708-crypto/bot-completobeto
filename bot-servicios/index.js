require('dotenv').config();
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const { useMongoDBAuthState } = require('./auth');
const { connectMongo } = require('./mongo');
const {
  compactText,
  chunkText,
  getMessageText,
  getMessageTimestamp,
  getQuotedMessageId,
  getSenderJid,
  isGroupJid,
  normalizePhone,
  parseServices
} = require('./utils');
const svc = require('./services');

const OWNER_JID = normalizePhone(process.env.OWNER_PHONE);
let socket = null;
let reconnectTimer = null;
let starting = false;
const recentBotFingerprints = new Map();

function log(...args) {
  console.log('[SERVICIOS]', ...args);
}

function rememberRecentBotText(jid, text) {
  const key = `${jid}:${compactText(text).slice(0, 200)}`;
  recentBotFingerprints.set(key, Date.now());
  const timer = setTimeout(() => {
    const at = recentBotFingerprints.get(key);
    if (at && Date.now() - at > 20000) recentBotFingerprints.delete(key);
  }, 21000);
  timer.unref?.();
}

function isRecentBotText(jid, text) {
  const key = `${jid}:${compactText(text).slice(0, 200)}`;
  const at = recentBotFingerprints.get(key);
  return !!at && Date.now() - at < 20000;
}

async function sendText(jid, text, kind = 'bot') {
  for (const chunk of chunkText(text)) {
    rememberRecentBotText(jid, chunk);
    await svc.sendBotMessage(jid, chunk, kind, socket);
  }
}

function ownerAllowed(msg) {
  if (msg?.key?.fromMe) return true;
  const sender = getSenderJid(msg, OWNER_JID);
  return !!OWNER_JID && sender === OWNER_JID;
}

async function handlePrompt(msg, groupId, cycleId, text, senderJid) {
  const prompt = await svc.getPrompt(groupId);
  if (!prompt || prompt.expiresAt < new Date()) {
    if (prompt) await svc.clearPrompt(groupId);
    return false;
  }

  if (prompt.userJid !== senderJid) return false;

  await svc.clearPrompt(groupId);

  if (prompt.kind === 'payment') {
    const result = await svc.payFromInput({
      groupId,
      cycleId,
      input: text,
      paymentMethod: 'pag'
    });
    await sendText(groupId, result.text, 'payment-result');
    return true;
  }

  return false;
}

async function processMessage(msg) {
  const chatJid = msg?.key?.remoteJid;
  if (!chatJid || !isGroupJid(chatJid) || !msg.message) return;

  const text = getMessageText(msg);
  if (!text) return;

  // WhatsApp puede marcar como fromMe tanto lo escrito desde el teléfono
  // como lo enviado por este bot. Por eso sólo ignoramos mensajes que
  // nosotros mismos registramos como enviados por el bot.
  if (await svc.isKnownBotMessage(msg)) return;
  if (msg.key.fromMe && isRecentBotText(chatJid, text)) return;

  const config = await svc.getConfig();
  const senderJid = getSenderJid(msg, OWNER_JID);
  const normalized = text.trim();
  let command = svc.getCommand(normalized);

  // Activación sólo para el dueño y queda ligada a un único grupo.
  if (command === 'activarbotservicios') {
    if (!ownerAllowed(msg)) return;

    const result = await svc.activate(
      chatJid,
      OWNER_JID || senderJid
    );

    await sendText(chatJid, result.text, 'activation');
    return;
  }

  // Si no está activado, ignora completamente este grupo.
  if (
    !config?.activatedGroupId ||
    config.activatedGroupId !== chatJid ||
    !config.activeCycleId
  ) return;

  // Responder al menú con 1-10 ejecuta automáticamente el comando correspondiente.
  const menuCommand = await svc.resolveMenuNumber(msg);
  if (menuCommand) command = menuCommand;

  if (
    command === 'pag' &&
    /^\d{1,2}$/.test(normalized) &&
    menuCommand === 'pag'
  ) {
    await svc.createPrompt(
      chatJid,
      senderJid,
      'payment',
      config.activeCycleId
    );

    await sendText(
      chatJid,
      '💬 *¿Quién pagó y cuánto?*\n\nEjemplos:\n*Dany 250*\n*250 Dany*\n\nSi hay varios servicios de la misma persona, sólo se marcará *uno*.',
      'payment-prompt'
    );
    return;
  }

  if (command === 'menu') {
    await sendText(chatJid, svc.menuText(), 'menu');
    return;
  }

  if (command === 'desactivarbotservicios') {
    if (!ownerAllowed(msg)) return;

    const result = await svc.deactivate(chatJid);
    await sendText(chatJid, result.text, 'deactivation');
    return;
  }

  if (command === 'cuentanueva') {
    if (!ownerAllowed(msg)) return;

    const result = await svc.newCycle(
      chatJid,
      svc.commandArgs(text)
    );

    await sendText(chatJid, result.text, 'new-cycle');
    return;
  }

  if (command === 'pag') {
    const quotedId = getQuotedMessageId(msg);

    if (quotedId) {
      const result = await svc.payByQuotedService({
        groupId: chatJid,
        cycleId: config.activeCycleId,
        quotedMessageId: quotedId,
        paymentMethod: 'pag'
      });

      await sendText(chatJid, result.text, 'payment-result');
      return;
    }

    const args = svc.commandArgs(text);

    if (args) {
      const result = await svc.payFromInput({
        groupId: chatJid,
        cycleId: config.activeCycleId,
        input: args,
        paymentMethod: 'pag'
      });

      await sendText(chatJid, result.text, 'payment-result');
      return;
    }

    await svc.createPrompt(
      chatJid,
      senderJid,
      'payment',
      config.activeCycleId
    );

    await sendText(
      chatJid,
      '💬 *¿Quién pagó y cuánto?*\n\nEjemplo: *Dany 250*',
      'payment-prompt'
    );
    return;
  }

  if (command === 'transferencia') {
    const quotedId = getQuotedMessageId(msg);

    if (!quotedId) {
      await sendText(
        chatJid,
        '⚠️ Responde al mensaje del servicio y escribe *transferencia* para marcar *un solo servicio* como pagado.',
        'help'
      );
      return;
    }

    const result = await svc.payByQuotedService({
      groupId: chatJid,
      cycleId: config.activeCycleId,
      quotedMessageId: quotedId,
      paymentMethod: 'transferencia'
    });

    await sendText(chatJid, result.text, 'payment-result');
    return;
  }

  if (command === 'vercuenta') {
    await sendText(
      chatJid,
      await svc.cuenta(chatJid, config.activeCycleId),
      'account'
    );
    return;
  }

  if (command === 'verdeudores') {
    await sendText(
      chatJid,
      await svc.debtors(chatJid, config.activeCycleId),
      'debtors'
    );
    return;
  }

  if (command === 'verpagados') {
    await sendText(
      chatJid,
      await svc.paid(chatJid, config.activeCycleId),
      'paid'
    );
    return;
  }

  if (command === 'listaservicios') {
    await sendText(
      chatJid,
      await svc.listServices(chatJid, config.activeCycleId),
      'service-list'
    );
    return;
  }

  // Una pregunta de pago pendiente se resuelve antes de interpretar el mensaje
  // como un servicio nuevo. Esto permite tanto "Dany 250" como "250 Dany".
  if (
    await handlePrompt(
      msg,
      chatJid,
      config.activeCycleId,
      text,
      senderJid
    )
  ) return;

  // Un mensaje normal con importe + nombre se guarda como servicio.
  // Sin ese formato se ignora silenciosamente.
  const parsedServices = parseServices(text);

  if (parsedServices.length) {
    const added = await svc.addServices({
      groupId: chatJid,
      cycleId: config.activeCycleId,
      messageId: msg.key.id,
      senderJid,
      timestamp: getMessageTimestamp(msg),
      text
    });

    if (added > 0) {
      log(`Registrados ${added} servicio(s) en ${chatJid}`);
    }

    return;
  }
}

async function connectWhatsApp() {
  if (starting || socket) return;
  starting = true;

  const auth = await useMongoDBAuthState();

  const sock = makeWASocket({
    auth: auth.state,
    printQRInTerminal: false,
    logger: pino({ level: process.env.LOG_LEVEL || 'info' }),
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    emitOwnEvents: true,
    getMessage: async () => ({ conversation: '' })
  });

  socket = sock;
  starting = false;

  sock.ev.on('creds.update', auth.saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      log('🟢 WhatsApp conectado.');

      const config = await svc.getConfig();

      if (!config?.activatedGroupId) {
        log('ℹ️ Conectado, pero todavía NO está activado en ningún grupo.');
      } else {
        log(`✅ Grupo reservado: ${config.activatedGroupId}`);
      }

      return;
    }

    // La primera vez se pide un código de vinculación y se imprime en los logs.
    if (
      connection === 'connecting' &&
      !auth.state.creds.me &&
      process.env.PAIRING_PHONE
    ) {
      const timer = setTimeout(async () => {
        try {
          if (socket !== sock || auth.state.creds.me) return;

          const phone = String(process.env.PAIRING_PHONE).replace(/\D/g, '');
          if (!phone) return;

          const code = await sock.requestPairingCode(phone);
          const pretty = code?.match(/.{1,4}/g)?.join('-') || code;

          console.log('\n=========================================');
          console.log('🔐 CÓDIGO DE VINCULACIÓN WHATSAPP');
          console.log(pretty);
          console.log('En WhatsApp: Dispositivos vinculados > Vincular con número de teléfono');
          console.log('=========================================\n');
        } catch (error) {
          console.error(
            '⚠️ No se pudo generar el código de vinculación:',
            error.message
          );
        }
      }, 5000);

      timer.unref?.();
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;

      socket = null;
      starting = false;

      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === 401
      ) {
        console.error(
          '🔴 WhatsApp cerró la sesión. Las credenciales siguen guardadas en MongoDB, pero si WhatsApp invalidó la sesión será necesario volver a vincular.'
        );
        return;
      }

      if (reconnectTimer) return;

      reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
          await connectWhatsApp();
        } catch (error) {
          console.error(
            '⚠️ Error reconectando WhatsApp:',
            error.message
          );
        }
      }, 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages || []) {
      try {
        await processMessage(msg);
      } catch (error) {
        console.error('❌ Error procesando mensaje:', error);
      }
    }
  });
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('Debes configurar MONGO_URI');
  }

  if (!process.env.OWNER_PHONE) {
    throw new Error('Debes configurar OWNER_PHONE');
  }

  await connectMongo();
  log('✅ MongoDB conectado.');
  await connectWhatsApp();
}

process.on('unhandledRejection', error => {
  console.error('UNHANDLED REJECTION:', error);
});

process.on('uncaughtException', error => {
  console.error('UNCAUGHT EXCEPTION:', error);
});

main().catch(error => {
  console.error('🚨 No se pudo iniciar el bot:', error);
  process.exit(1);
});

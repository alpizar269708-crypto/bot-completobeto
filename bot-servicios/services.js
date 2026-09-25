const {
  Config,
  Cycle,
  Service,
  BotMessage,
  Prompt,
  id
} = require('./mongo');
const {
  compactText,
  formatDate,
  money,
  normalizeText,
  parseMoney,
  parseNameAndAmount,
  parseServices,
  similarity,
  getQuotedMessageId
} = require('./utils');

const COMMANDS = [
  { number: 1, name: 'activarbotservicios', aliases: ['activarbotservicios', 'activar bot servicios'], ownerOnly: true },
  { number: 2, name: 'vercuenta', aliases: ['vercuenta', 'ver cuenta'] },
  { number: 3, name: 'cuentanueva', aliases: ['cuentanueva', 'cuenta nueva'], ownerOnly: true },
  { number: 4, name: 'pag', aliases: ['pag', 'pago', 'pagado'] },
  { number: 5, name: 'transferencia', aliases: ['transferencia', 'transfer'] },
  { number: 6, name: 'verdeudores', aliases: ['verdeudores', 'ver deudores', 'deudores'] },
  { number: 7, name: 'verpagados', aliases: ['verpagados', 'ver pagados', 'pagados'] },
  { number: 8, name: 'listaservicios', aliases: ['listaservicios', 'lista servicios', 'servicios'] },
  { number: 9, name: 'menu', aliases: ['menu', 'menú'] },
  { number: 10, name: 'desactivarbotservicios', aliases: ['desactivarbotservicios', 'desactivar bot servicios'], ownerOnly: true }
];

const MENU_MAP = Object.fromEntries(COMMANDS.map(c => [String(c.number), c.name]));
const COMMAND_ALIASES = new Map();
for (const c of COMMANDS) {
  for (const alias of c.aliases) COMMAND_ALIASES.set(compactText(alias), c.name);
}

function levenshteinCompact(a, b) {
  if (a === b) return 0;
  const prev = Array(b.length + 1).fill(0);
  const cur = Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function getCommand(text) {
  const normalized = text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const first = normalized.split(/\s+/)[0];
  const compact = compactText(first);

  if (COMMAND_ALIASES.has(compact)) return COMMAND_ALIASES.get(compact);

  let best = null;
  for (const [alias, command] of COMMAND_ALIASES) {
    const d = levenshteinCompact(compact, alias);
    const threshold = alias.length >= 10 ? 2 : 1;
    if (d <= threshold && (!best || d < best.distance)) best = { command, distance: d };
  }
  return best?.command || null;
}

function commandArgs(text) {
  return text.trim().replace(/^\S+\s*/, '').trim();
}

function menuText() {
  return [
    '📋 *MENÚ BOT DE SERVICIOS*',
    '',
    '1️⃣ activarbotservicios',
    '2️⃣ vercuenta',
    '3️⃣ cuentanueva <cantidad>',
    '4️⃣ pag',
    '5️⃣ transferencia',
    '6️⃣ verdeudores',
    '7️⃣ verpagados',
    '8️⃣ listaservicios',
    '9️⃣ menu',
    '🔟 desactivarbotservicios',
    '',
    '💡 Responde a este mensaje con *el número* del comando.',
    '💡 Los nombres aceptan acentos, mayúsculas y pequeños errores de escritura.'
  ].join('\n');
}

async function getConfig() {
  return Config.findById('global').lean();
}

async function activate(groupId, ownerJid) {
  const config = await Config.findById('global');

  if (config.activatedGroupId && config.activatedGroupId !== groupId) {
    return {
      ok: false,
      text: '🔒 El bot de servicios ya está reservado para otro grupo.\nUsa *desactivarbotservicios* en el grupo actual para liberarlo antes de activarlo en otro.'
    };
  }

  if (config.activatedGroupId === groupId) {
    return { ok: true, text: '✅ El bot de servicios ya está activo en este grupo.' };
  }

  const cycleId = id('cycle');
  await Cycle.create({
    _id: cycleId,
    groupId,
    startingAmount: 0,
    startedAt: new Date()
  });

  config.activatedGroupId = groupId;
  config.ownerJid = ownerJid;
  config.activeCycleId = cycleId;
  config.updatedAt = new Date();
  await config.save();

  return {
    ok: true,
    text: '✅ *Bot de servicios activado.*\n\nEste grupo queda reservado para el bot.\nLa lista empieza en $0.00.\n\nYa puedes mandar mensajes como:\n*250 dany*\n*220 tal*\n*-100 fulano*'
  };
}

async function deactivate(groupId) {
  const config = await Config.findById('global');

  if (!config.activatedGroupId || config.activatedGroupId !== groupId) {
    return { ok: false, text: 'ℹ️ Este grupo no es el grupo reservado del bot de servicios.' };
  }

  config.activatedGroupId = null;
  config.activeCycleId = null;
  config.updatedAt = new Date();
  await config.save();

  return {
    ok: true,
    text: '⏹️ Bot de servicios desactivado en este grupo.\nLos datos anteriores siguen guardados en MongoDB.'
  };
}

async function newCycle(groupId, rawAmount) {
  const amount = parseMoney(rawAmount);

  if (amount === null) {
    return { ok: false, text: '⚠️ Usa: *cuentanueva 5000* o *cuentanueva 5,000*.' };
  }

  const config = await Config.findById('global');
  if (!config.activatedGroupId || config.activatedGroupId !== groupId) {
    return { ok: false, text: '⚠️ El bot no está activo en este grupo.' };
  }

  if (config.activeCycleId) {
    await Cycle.updateOne(
      { _id: config.activeCycleId },
      { $set: { closedAt: new Date() } }
    );
  }

  const cycleId = id('cycle');
  await Cycle.create({
    _id: cycleId,
    groupId,
    startingAmount: amount,
    startedAt: new Date()
  });

  config.activeCycleId = cycleId;
  config.updatedAt = new Date();
  await config.save();

  return {
    ok: true,
    text: `🔄 *Cuenta nueva creada.*\n\nSaldo inicial: *${money(amount)}*\nTodo lo de la lista anterior queda fuera de la cuenta activa.\nLos datos antiguos se conservan en MongoDB.`
  };
}

async function addServices({ groupId, cycleId, messageId, senderJid, timestamp, text }) {
  const parsed = parseServices(text);
  if (!parsed.length) return 0;

  const docs = parsed.map((item, index) => ({
    _id: `${messageId}_${index + 1}`,
    cycleId,
    groupId,
    sourceMessageId: messageId,
    senderJid,
    amount: item.amount,
    name: item.name,
    normalizedName: normalizeText(item.name),
    status: 'pending',
    createdAt: timestamp
  }));

  await Service.bulkWrite(
    docs.map(doc => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $setOnInsert: doc },
        upsert: true
      }
    }))
  );

  return docs.length;
}

async function sendBotMessage(chatJid, text, kind, sock) {
  const fingerprint = compactText(text).slice(0, 200);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const result = await sock.sendMessage(chatJid, { text });

  if (result?.key?.id) {
    await BotMessage.findOneAndUpdate(
      { _id: result.key.id },
      {
        $set: {
          jid: chatJid,
          kind,
          textFingerprint: fingerprint,
          createdAt: new Date(),
          expiresAt
        }
      },
      { upsert: true }
    );
  }

  return result;
}

async function isKnownBotMessage(msg) {
  const messageId = msg?.key?.id;
  if (!messageId) return false;
  return !!(await BotMessage.exists({ _id: messageId }));
}

async function createPrompt(groupId, userJid, kind, cycleId) {
  await Prompt.findOneAndUpdate(
    { _id: groupId },
    {
      $set: {
        groupId,
        userJid,
        kind,
        cycleId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    },
    { upsert: true }
  );
}

async function getPrompt(groupId) {
  return Prompt.findById(groupId).lean();
}

async function clearPrompt(groupId) {
  await Prompt.deleteOne({ _id: groupId });
}

async function markPaidByService(service, paidByName, paymentMethod = 'pag') {
  return Service.findOneAndUpdate(
    { _id: service._id, status: 'pending' },
    {
      $set: {
        status: 'paid',
        paidAt: new Date(),
        paidByName: paidByName || service.name,
        paymentMethod
      }
    },
    { new: true }
  );
}

async function findBestPending(groupId, cycleId, name, amount) {
  const pending = await Service.find({
    groupId,
    cycleId,
    status: 'pending'
  }).sort({ createdAt: 1 }).lean();

  if (!pending.length) return { service: null, candidates: [] };

  const candidates = pending
    .filter(item => amount === null || Number(item.amount) === Number(amount))
    .map(item => ({
      service: item,
      score: similarity(name, item.name)
    }))
    .sort((a, b) =>
      b.score - a.score ||
      new Date(a.service.createdAt) - new Date(b.service.createdAt)
    );

  return {
    service: candidates[0]?.score >= 0.55 ? candidates[0].service : null,
    candidates: candidates.slice(0, 5)
  };
}

async function payFromInput({ groupId, cycleId, input, paymentMethod = 'pag' }) {
  const parsed = parseNameAndAmount(input);

  if (!parsed?.name) {
    return { ok: false, text: '⚠️ Escribe algo como: *Dany 250*.' };
  }

  const result = await findBestPending(
    groupId,
    cycleId,
    parsed.name,
    parsed.amount
  );

  if (!result.service) {
    if (!result.candidates.length) {
      return { ok: false, text: '❌ No encontré servicios pendientes con esos datos.' };
    }

    const suggestions = result.candidates
      .map(x => `• ${x.service.name} — ${money(x.service.amount)}`)
      .join('\n');

    return {
      ok: false,
      text: `❌ No encontré una coincidencia suficiente.\n\nPosibles coincidencias:\n${suggestions}\n\nPrueba con *nombre cantidad*.`
    };
  }

  const paid = await markPaidByService(
    result.service,
    result.service.name,
    paymentMethod
  );

  return {
    ok: true,
    text: `${paymentMethod === 'transferencia' ? '🏦' : '✅'} *Pago registrado*\n\n${paid.name} — ${money(paid.amount)}\nFecha: ${formatDate(paid.paidAt)}\nForma: ${paymentMethod === 'transferencia' ? 'Transferencia' : 'Pago'}`
  };
}

async function payByQuotedService({
  groupId,
  cycleId,
  quotedMessageId,
  paymentMethod = 'pag'
}) {
  const service = await Service.findOne({
    groupId,
    cycleId,
    sourceMessageId: quotedMessageId,
    status: 'pending'
  }).sort({ createdAt: 1 }).lean();

  if (!service) {
    return {
      ok: false,
      text: '❌ No encontré un servicio pendiente asociado al mensaje seleccionado.'
    };
  }

  await markPaidByService(service, service.name, paymentMethod);

  return {
    ok: true,
    text: `${paymentMethod === 'transferencia' ? '🏦' : '✅'} *${paymentMethod === 'transferencia' ? 'Transferencia registrada' : 'Pago registrado'}*\n\n${service.name} — ${money(service.amount)}\nFecha: ${formatDate(new Date())}\nForma: ${paymentMethod === 'transferencia' ? 'Transferencia' : 'Pago'}`
  };
}

async function cuenta(groupId, cycleId) {
  const cycle = await Cycle.findById(cycleId).lean();
  const services = await Service.find({ groupId, cycleId }).lean();

  const servicesTotal = services.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );
  const total = Number(cycle?.startingAmount || 0) + servicesTotal;

  const count250 = services.filter(item => Number(item.amount) === 250).length;
  const count35 = services.filter(item => Number(item.amount) === 35).length;
  const m250 = Number(process.env.MULTIPLIER_250 || 20);
  const m35 = Number(process.env.MULTIPLIER_35 || 20);

  return [
    '💰 *CUENTA ACTUAL*',
    '',
    `Saldo inicial: *${money(cycle?.startingAmount || 0)}*`,
    `Servicios sumados: *${money(servicesTotal)}*`,
    `Total: *${money(total)}*`,
    '',
    `250 → ${count250} × ${m250} = *${money(count250 * m250)}*`,
    `35 → ${count35} × ${m35} = *${money(count35 * m35)}*`,
    '',
    `📦 Servicios registrados: *${services.length}*`
  ].join('\n');
}

async function debtors(groupId, cycleId) {
  const pending = await Service.find({
    groupId,
    cycleId,
    status: 'pending'
  }).sort({ createdAt: 1 }).lean();

  if (!pending.length) {
    return '🟢 *DEUDORES*\n\nNo hay servicios pendientes de pago.';
  }

  const grouped = new Map();

  for (const service of pending) {
    const key = compactText(service.name);
    if (!grouped.has(key)) {
      grouped.set(key, {
        name: service.name,
        items: [],
        total: 0
      });
    }

    const entry = grouped.get(key);
    entry.items.push(service);
    entry.total += Number(service.amount || 0);
  }

  const lines = ['🔴 *DEUDORES*', ''];

  for (const entry of grouped.values()) {
    lines.push(
      `• *${entry.name}* — ${entry.items.length} servicio(s) — ${money(entry.total)}`
    );
    for (const item of entry.items) {
      lines.push(`  ↳ ${money(item.amount)} · ${formatDate(item.createdAt)}`);
    }
  }

  return lines.join('\n');
}

async function paid(groupId, cycleId) {
  const items = await Service.find({
    groupId,
    cycleId,
    status: 'paid'
  }).sort({ paidAt: -1 }).lean();

  if (!items.length) {
    return '⚪ *PAGADOS*\n\nTodavía no hay pagos registrados.';
  }

  const lines = ['🟢 *PAGADOS*', ''];

  for (const item of items) {
    lines.push(
      `• *${item.name}* — ${money(item.amount)} — ${formatDate(item.paidAt)}`
    );
    lines.push(
      `  ↳ ${item.paymentMethod === 'transferencia' ? 'Transferencia' : 'Pago'}`
    );
  }

  return lines.join('\n');
}

async function listServices(groupId, cycleId) {
  const cycle = await Cycle.findById(cycleId).lean();
  const items = await Service.find({
    groupId,
    cycleId
  }).sort({ createdAt: 1 }).lean();

  if (!items.length) {
    return '📭 *LISTA DE SERVICIOS*\n\nNo hay servicios registrados en esta cuenta.';
  }

  const lines = [
    '📋 *LISTA DE SERVICIOS*',
    '',
    `Inicio: ${formatDate(cycle?.startedAt || new Date())}`,
    `Cantidad: ${items.length}`,
    ''
  ];

  items.forEach((item, index) => {
    const icon = item.status === 'paid' ? '✅' : '⏳';
    const extra = item.status === 'paid'
      ? ` · pagó ${formatDate(item.paidAt)}`
      : '';

    lines.push(
      `${index + 1}. ${icon} *${item.name}* — ${money(item.amount)} · ${formatDate(item.createdAt)}${extra}`
    );
  });

  return lines.join('\n');
}

async function resolveMenuNumber(msg) {
  const text = String(
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    ''
  ).trim();

  if (!/^\d{1,2}$/.test(text)) return null;

  const quotedId = getQuotedMessageId(msg);
  if (!quotedId) return null;

  const menu = await BotMessage.findOne({
    _id: quotedId,
    kind: 'menu'
  }).lean();

  if (!menu) return null;
  return MENU_MAP[text] || null;
}

module.exports = {
  COMMANDS,
  MENU_MAP,
  getCommand,
  commandArgs,
  menuText,
  getConfig,
  activate,
  deactivate,
  newCycle,
  addServices,
  sendBotMessage,
  isKnownBotMessage,
  createPrompt,
  getPrompt,
  clearPrompt,
  payFromInput,
  payByQuotedService,
  cuenta,
  debtors,
  paid,
  listServices,
  resolveMenuNumber
};

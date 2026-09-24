const { User, EconomiaGrupo } = require('../database/modelos');
const { resolverContactoWhatsApp, resolverJidUsuario, tokenMencionNativa } = require('../utils/whatsapp');

async function obtenerEconomia(chatId, numero) {
    if (!chatId || !numero) throw new Error('Faltan chatId o numero para la economía.');
    let economia = await EconomiaGrupo.findOne({ chatId, numero });
    if (economia) return economia;

    const legado = await User.findOne({ numero }).select('cartera banco inventario ultimoDaily ultimoWeekly ultimoTrabajo').lean();
    const datosLegado = legado ? {
        cartera: Number(legado.cartera) || 0,
        banco: Number(legado.banco) || 0,
        inventario: Array.isArray(legado.inventario) ? legado.inventario : [],
        ultimoDaily: legado.ultimoDaily || null,
        ultimoWeekly: legado.ultimoWeekly || null,
        ultimoTrabajo: legado.ultimoTrabajo || null
    } : {};

    try {
        economia = await EconomiaGrupo.create({ chatId, numero, ...datosLegado });
    } catch (e) {
        if (e?.code === 11000) economia = await EconomiaGrupo.findOne({ chatId, numero });
        else throw e;
    }

    if (legado && (legado.cartera !== undefined || legado.banco !== undefined || legado.inventario !== undefined || legado.ultimoDaily || legado.ultimoWeekly || legado.ultimoTrabajo)) {
        await User.updateOne({ numero }, { $unset: { cartera: 1, banco: 1, inventario: 1, ultimoDaily: 1, ultimoWeekly: 1, ultimoTrabajo: 1 } });
    }
    return economia;
}

async function limpiarEconomiaAlSalir(chatId, participantes = []) {
    if (!chatId?.endsWith('@g.us') || !Array.isArray(participantes) || participantes.length === 0) return;
    const numeros = participantes.map(p => typeof p === 'string' ? p : p?.id).filter(Boolean);
    if (numeros.length === 0) return;

    const resultado = await EconomiaGrupo.deleteMany({ chatId, numero: { $in: numeros } });
    if (resultado.deletedCount > 0) console.log(`🧹 Economía limpiada: ${resultado.deletedCount} registro(s) de integrantes que salieron de ${chatId}.`);
}

async function obtenerObjetivo(sock, msg, args = []) {
    const citado = msg.message?.extendedTextMessage?.contextInfo;
    const mencionadoPorEtiqueta = citado?.mentionedJid?.[0];
    const mencionadoPorRespuesta = citado?.participant;
    if (mencionadoPorEtiqueta) return await resolverJidUsuario(sock, mencionadoPorEtiqueta);
    if (mencionadoPorRespuesta) return await resolverJidUsuario(sock, mencionadoPorRespuesta);
    if (args && args.length > 0) {
        const textoUnido = args.join('');
        const numeros = textoUnido.replace(/[^0-9]/g, '');
        if (numeros.length > 5) return await resolverJidUsuario(sock, numeros);
    }
    return null;
}

async function comandoCartera(sock, chatId, msg, usuarioBD) {
    const cartera = usuarioBD.cartera || 0;
    const banco = usuarioBD.banco || 0;
    const total = cartera + banco;
    const remitente = msg.key.participant || chatId;
    const jid = remitente;
    const contacto = await resolverContactoWhatsApp(sock, jid, chatId);
    const etiquetaContacto = tokenMencionNativa(contacto.jid || jid) || contacto.nombre || contacto.numeroVisible;
    let texto = `💰 *ESTADO FINANCIERO*\\n\\n` +
                `👤 Usuario: ${etiquetaContacto}\\n` +
                `💵 En mano: *${cartera} monedas*\\n` +
                `🏦 En banco: *${banco} monedas*\\n` +
                `💎 Total neto: *${total} monedas*`;
    await sock.sendMessage(chatId, { text: texto, mentions: [contacto.jid || jid].filter(Boolean) }, { quoted: msg });
}

// El resto del archivo permanece sin cambios.
async function comandoBanco(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoPay(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoTop(sock, chatId, msg) { /* ... */ }
async function comandoDaily(sock, chatId, msg, usuarioBD) { /* ... */ }
async function comandoWeekly(sock, chatId, msg, usuarioBD) { /* ... */ }
async function ejecutarFarmeo(sock, chatId, msg, usuarioBD, tipo) { /* ... */ }
async function comandoRuleta(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoCf(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoSlots(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoDados(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoAdivina(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoBuscaminas(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoRob(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoPpt(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoPelea(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoCarrera(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoHackear(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoShop(sock, chatId, msg) { /* ... */ }
async function comandoBuy(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoInventario(sock, chatId, msg, usuarioBD) { /* ... */ }
async function comandoVender(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoUse(sock, chatId, msg, args, usuarioBD) { /* ... */ }
async function comandoRegalarItem(sock, chatId, msg, args, usuarioBD) { /* ... */ }

module.exports = {
    comandoCartera, comandoBanco, comandoPay, comandoTop, comandoDaily, comandoWeekly,
    ejecutarFarmeo, comandoRuleta, comandoCf, comandoSlots, comandoDados, comandoAdivina,
    comandoBuscaminas, comandoRob, comandoPpt, comandoPelea, comandoCarrera, comandoHackear,
    comandoShop, comandoBuy, comandoInventario, comandoVender, comandoUse, comandoRegalarItem,
    obtenerEconomia, limpiarEconomiaAlSalir
};
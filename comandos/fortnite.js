const cron = require('node-cron');
const { Config } = require('../database/modelos');

function obtenerFechaActual() {
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

async function esAdminValido(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: `❌ Este comando solo se puede usar en grupos.` }, { quoted: msg });
        return false;
    }
    if (msg.key.fromMe) return true; 
    
    const remitente = msg.key.participant;
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participante = groupMetadata.participants.find(p => p.id === remitente);
        if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
            return true;
        }
    } catch (e) {}

    await sock.sendMessage(chatId, { text: `❌ Comando exclusivo para administradores del grupo.` }, { quoted: msg });
    return false;
}

async function obtenerAlertasSTW() {
    let pavos = [];
    let epicas = [];
    let legendarias = []; 

    try {
        let manualPavos = await Config.findOne({ clave: 'stw_pavos_activos' });
        if (manualPavos && manualPavos.valor) pavos = pavos.concat(JSON.parse(manualPavos.valor));

        let manualEpicas = await Config.findOne({ clave: 'stw_epicas_activas' });
        if (manualEpicas && manualEpicas.valor) epicas = epicas.concat(JSON.parse(manualEpicas.valor));

        let manualLegendarias = await Config.findOne({ clave: 'stw_legendarias_activas' });
        if (manualLegendarias && manualLegendarias.valor) legendarias = legendarias.concat(JSON.parse(manualLegendarias.valor));
    } catch (e) {
        console.error("Error leyendo alertas de STW:", e);
    }

    return { pavos, epicas, legendarias };
}

async function alertasSTW(sock, chatId, msg, categoria = 'todas') {
    const datos = await obtenerAlertasSTW();
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n`;

    if (categoria === 'pavos' || categoria === 'todas') {
        texto += `🎮 *ALERTAS DE PAVOS*\n`;
        if (datos.pavos.length === 0) {
            texto += `_No hay alertas de pavos registradas._\n\n`;
        } else {
            let totalPavos = 0;
            datos.pavos.forEach(p => {
                totalPavos += p.cantidad || 50;
                texto += `⚡ *PL:* ${p.pl} | 🎯 *Misión:* ${p.mision}\n🪙 *PaVos:* ${p.cantidad || 50}\n\n`;
            });
            texto += `💰 *Total del día:* ${totalPavos} paVos\n\n`;
        }
    }

    if (categoria === 'epicas' || categoria === 'todas') {
        texto += `🟣 *ALERTAS ÉPICAS*\n`;
        if (datos.epicas.length === 0) {
            texto += `_No hay alertas épicas registradas._\n\n`;
        } else {
            datos.epicas.forEach(e => {
                texto += `⚡ *PL:* ${e.pl} | 🎯 *Misión:* ${e.mision}\n🎁 *Recompensa:* ${e.recompensa}\n\n`;
            });
        }
    }

    if (categoria === 'legendarias' || categoria === 'todas') {
        texto += `🌟 *ALERTAS LEGENDARIAS*\n`;
        if (datos.legendarias.length === 0) {
            texto += `_No hay alertas legendarias registradas._\n\n`;
        } else {
            datos.legendarias.forEach(L => {
                texto += `⚡ *PL:* ${L.pl} | 🎯 *Misión:* ${L.mision}\n🎁 *Recompensa:* ${L.recompensa}\n\n`;
            });
        }
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

async function comandoSetPavos(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    const partes = args.join(' ').split('|').map(p => p.trim());
    if (partes.length < 3) return await sock.sendMessage(chatId, { text: `❌ Uso: setpavos PL | Misión | Cantidad` }, { quoted: msg });
    let actual = await Config.findOne({ clave: 'stw_pavos_activos' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    lista.push({ pl: partes[0], mision: partes[1], cantidad: parseInt(partes[2]) || 50, tipo: 'Manual' });
    await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ PaVos manuales agregados.` }, { quoted: msg });
}

async function comandoSetLegendarias(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    const partes = args.join(' ').split('|').map(p => p.trim());
    if (partes.length < 3) return await sock.sendMessage(chatId, { text: `❌ Uso: setlegendarias PL | Misión | Recompensa` }, { quoted: msg });
    let actual = await Config.findOne({ clave: 'stw_legendarias_activas' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    lista.push({ pl: partes[0], mision: partes[1], recompensa: partes[2] });
    await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ Recompensa manual agregada.` }, { quoted: msg });
}

async function comandoResetPavos(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'stw_pavos_activos' });
    await Config.findOneAndDelete({ clave: 'stw_epicas_activas' });
    await Config.findOneAndDelete({ clave: 'stw_legendarias_activas' });
    await sock.sendMessage(chatId, { text: `🗑️ Alertas restablecidas.` }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg) {
    await sock.sendMessage(chatId, { text: `🤖 Escribe *stw*, *legendariasstw* o *epicasstw*.` }, { quoted: msg });
}

function iniciarCronAlertasDiarias(sock) {
    cron.schedule('5 18 * * *', async () => {
        try {
            const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
            if (!configChat || !configChat.valor) return;
            const datos = await obtenerAlertasSTW();
            let total = datos.pavos.reduce((acc, p) => acc + (p.cantidad || 50), 0);

            let mensajeAuto = `🎮 *REPORTE DIARIO STW (6:05 PM)*\n\n`;
            if (datos.pavos.length > 0) {
                datos.pavos.forEach(p => {
                    mensajeAuto += `⚡ PL: ${p.pl} | 🎯 ${p.mision} | 🪙 ${p.cantidad || 50} PaVos\n`;
                });
                mensajeAuto += `\n💰 *Total del día:* ${total} paVos\n\n`;
            }
            if (datos.legendarias.length > 0) {
                mensajeAuto += `🌟 *LEGENDARIAS*\n`;
                datos.legendarias.forEach(L => {
                    mensajeAuto += `⚡ PL: ${L.pl} | 🎯 ${L.mision} | 🎁 ${L.recompensa}\n`;
                });
            }
            mensajeAuto += `\nSupport-a-Creator: *JASC13* ❤️`;
            await sock.sendMessage(configChat.valor, { text: mensajeAuto });
        } catch (error) {}
    }, { scheduled: true, timezone: "America/Mexico_City" });
}

async function activarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndUpdate({ clave: 'chat_alertas_diarias' }, { valor: chatId }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ *Grupo vinculado.* Reportes automáticos diarios configurados.` }, { quoted: msg });
}

async function desactivarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'chat_alertas_diarias' });
    await sock.sendMessage(chatId, { text: `🔕 *Alertas desactivadas en este grupo.*` }, { quoted: msg });
}

module.exports = { 
    obtenerAlertasSTW, alertasSTW, comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias, 
    comandoSetPavos, comandoSetLegendarias, comandoResetPavos
};
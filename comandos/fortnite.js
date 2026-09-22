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

async function leerConfigJSON(clave) {
    try {
        const doc = await Config.findOne({ clave });
        if (!doc || !doc.valor) return [];
        const parsed = JSON.parse(doc.valor);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error(`Error leyendo ${clave}:`, e.message);
        return [];
    }
}

function combinarSinDuplicados(...listas) {
    const mapa = new Map();

    for (const lista of listas) {
        for (const item of lista) {
            const clave = JSON.stringify({
                pl: item.pl ?? null,
                mision: item.mision ?? '',
                ubicacion: item.ubicacion ?? '',
                recompensa: item.recompensa ?? '',
                cantidad: item.cantidad ?? null,
                rareza: item.rareza ?? ''
            });

            if (!mapa.has(clave)) {
                mapa.set(clave, item);
            }
        }
    }

    return Array.from(mapa.values());
}

// PLALTAS: STW Planner puede guardar dos representaciones de la misma
// misión de PaVos (bloque especial y mission-entry normal). Al mostrar el
// comando, se agrupan por la misión y se conserva la versión más limpia.
function deduplicarPlAltasVbucks(lista) {
    const mapa = new Map();

    for (const item of Array.isArray(lista) ? lista : []) {
        const textoRecompensa = String(item.recompensa || '');
        const esVbucks = /PaVos|vbucks|v-bucks/i.test(textoRecompensa);

        const claveBase = [
            item.zona ?? '',
            item.pl ?? '',
            item.mision ?? '',
            item.ubicacion ?? ''
        ].join('|').toLowerCase();

        const clave = esVbucks
            ? 'vbucks|' + claveBase
            : 'normal|' + claveBase + '|' + textoRecompensa.toLowerCase();

        const anterior = mapa.get(clave);

        if (!anterior) {
            mapa.set(clave, item);
            continue;
        }

        if (esVbucks) {
            const cantidadRecompensasAnterior = String(
                anterior.recompensa || ''
            )
                .split('|')
                .filter(Boolean)
                .length;

            const cantidadRecompensasActual = textoRecompensa
                .split('|')
                .filter(Boolean)
                .length;

            if (cantidadRecompensasActual < cantidadRecompensasAnterior) {
                mapa.set(clave, item);
            }
        }
    }

    return Array.from(mapa.values());
}

async function obtenerAlertasSTW(actualizarEnVivo = true) {
    // Cada comando de STW refresca primero desde STW Planner para no
    // depender de datos viejos almacenados en MongoDB.
    if (actualizarEnVivo) {
        try {
            const { extraerAlertasAPI } = require('../webBridge');
            await extraerAlertasAPI();
        } catch (e) {
            console.error('⚠️ No se pudo refrescar STW Planner en vivo:', e.message);
        }
    }

    const [
        scrapePavos,
        scrapeEpicas,
        scrapeLegendarias,
        scrapePlAltas,
        manualPavos,
        manualEpicas,
        manualLegendarias
    ] = await Promise.all([
        leerConfigJSON('stw_pavos_scrapeados'),
        leerConfigJSON('stw_epicas_scrapeadas'),
        leerConfigJSON('stw_legendarias_scrapeadas'),
        leerConfigJSON('stw_plaltas_scrapeadas'),
        leerConfigJSON('stw_pavos_activos'),
        leerConfigJSON('stw_epicas_activas'),
        leerConfigJSON('stw_legendarias_activas')
    ]);

    return {
        pavos: combinarSinDuplicados(scrapePavos, manualPavos),
        epicas: combinarSinDuplicados(scrapeEpicas, manualEpicas),
        legendarias: combinarSinDuplicados(scrapeLegendarias, manualLegendarias),
        plAltas: deduplicarPlAltasVbucks(scrapePlAltas)
    };
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
                texto += `⚡ *PL:* ${p.pl}\n🎯 *Misión:* ${p.mision}\n🪙 *PaVos:* ${p.cantidad || 50}\n\n`;
            });
            texto += `💰 *Total del día:* ${totalPavos} paVos\n\n`;
        }
    }

    if (categoria === 'epicas' || (categoria === 'todas' && datos.epicas.length > 0)) {
        texto += `🟣 *ALERTAS ÉPICAS*\n`;
        if (datos.epicas.length === 0) {
            texto += `_No hay alertas épicas registradas._\n\n`;
        } else {
            datos.epicas.forEach(e => {
                texto += `⚡ *PL:* ${e.pl}\n🎯 *Misión:* ${e.mision}\n🎁 *Recompensa:* ${e.recompensa}\n\n`;
            });
        }
    }

    if (categoria === 'legendarias' || (categoria === 'todas' && datos.legendarias.length > 0)) {
        texto += `🌟 *ALERTAS LEGENDARIAS*\n`;
        if (datos.legendarias.length === 0) {
            texto += `_No hay alertas legendarias registradas._\n\n`;
        } else {
            datos.legendarias.forEach(L => {
                texto += `⚡ *PL:* ${L.pl}\n🎯 *Misión:* ${L.mision}\n🎁 *Recompensa:* ${L.recompensa}\n\n`;
            });
        }
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

// === NUEVA FUNCIÓN PARA EL COMANDO PLALTAS ===
async function comandoPLaltas(sock, chatId, msg) {
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n🔥 *ALERTAS DESTACADAS — RECOMPENSAS BUENAS*\n\n`;

    try {
        const datos = await obtenerAlertasSTW();
        let listaPlAltas = datos.plAltas || [];

        if (listaPlAltas.length === 0) {
            texto += `_No hay alertas de PLs altas registradas en este momento._\n\n`;
        } else {
            listaPlAltas.forEach(item => {
                texto += `⭐ *ALERTA DESTACADA*\n`;
                texto += `⚡ *PL:* ${item.pl}\n`;
                if (item.zona) texto += `🌍 *Zona:* ${item.zona}\n`;
                if (item.ubicacion) texto += `📍 *Ubicación:* ${item.ubicacion}\n`;
                if (item.tipoAlertaTexto && item.tipoAlertaText !== 'PaVos') {
                    texto += `🚨 *Tipo de alerta:* ${item.tipoAlertaTexto}\n`;
                }
                if (item.esX4) {
                    texto += `✖️ *Recompensa x4:* Sí\n`;
                }
                texto += `🎯 *Misión:* ${item.mision}\n`;
                texto += `🎁 *Recompensa:* ${item.recompensa || item.motivo || 'Recompensa destacada'}\n`;
                if (Array.isArray(item.modificadores) && item.modificadores.length > 0) {
                    texto += `⚠️ *Modificadores:* ${item.modificadores.join(' • ')}\n`;
                }
                texto += `\n`;
            });
        }
    } catch (e) {
        texto += `_Error al cargar las alertas de PL altas._\n\n`;
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
    await sock.sendMessage(chatId, { text: `🤖 Escribe *stw*, *PLaltas* o *legendariasstw*.` }, { quoted: msg });
}

function iniciarCronAlertasDiarias(sock) {
    cron.schedule('2 18 * * *', async () => {
        try {
            const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
            if (!configChat || !configChat.valor) return;
            const datos = await obtenerAlertasSTW();
            let total = datos.pavos.reduce((acc, p) => acc + (p.cantidad || 50), 0);

            let mensajeAuto = `🎮 *REPORTE DIARIO STW (6:02 PM)*\n\n`;
            mensajeAuto += `🎮 *ALERTAS DE PAVOS*\n`;
            if (datos.pavos.length > 0) {
                datos.pavos.forEach(p => {
                    mensajeAuto += `⚡ PL: ${p.pl}\n🎯 ${p.mision}\n🪙 ${p.cantidad || 50} PaVos\n\n`;
                });
                mensajeAuto += `💰 *Total del día:* ${total} paVos\n\n`;
            } else {
                mensajeAuto += `_No hay alertas de pavos registradas._\n\n`;
            }

            if (datos.legendarias.length > 0) {
                mensajeAuto += `🌟 *LEGENDARIAS*\n`;
                datos.legendarias.forEach(L => {
                    mensajeAuto += `⚡ PL: ${L.pl}\n🎯 ${L.mision}\n🎁 ${L.recompensa}\n\n`;
                });
            }
            mensajeAuto += `Support-a-Creator: *JASC13* ❤️`;
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
    obtenerAlertasSTW, alertasSTW, comandoPLaltas, comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias, 
    comandoSetPavos, comandoSetLegendarias, comandoResetPavos
};
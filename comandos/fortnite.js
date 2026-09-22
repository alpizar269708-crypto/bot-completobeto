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
        scrapePlAltas
    ] = await Promise.all([
        leerConfigJSON('stw_pavos_scrapeados'),
        leerConfigJSON('stw_epicas_scrapeadas'),
        leerConfigJSON('stw_legendarias_scrapeadas'),
        leerConfigJSON('stw_plaltas_scrapeadas')
    ]);

    // Desde ahora STW Planner es la única fuente de alertas automáticas.
    // Las listas manuales antiguas ya no se mezclan para evitar duplicados.
    return {
        pavos: scrapePavos,
        epicas: scrapeEpicas,
        legendarias: scrapeLegendarias,
        plAltas: deduplicarPlAltasVbucks(scrapePlAltas)
    };
}

function obtenerRecompensasValiosasSTW(item) {
    const recompensas = Array.isArray(item.recompensas) ? item.recompensas : [];

    const valiosas = recompensas.filter(r => {
        if (!r || !r.tipo) return false;

        const nombre = String(r.nombre || '').toLowerCase();

        // No mostrar recompensas genéricas ni recompensas comunes.
        if (
            r.tipo === 'other' ||
            r.rareza === 'common' ||
            r.rareza === 'uncommon' ||
            /\bcom[uú]n\b/.test(nombre) ||
            /recompensa com[uú]n/.test(nombre)
        ) {
            return false;
        }

        if (['hero', 'survivor', 'defender', 'schematic'].includes(r.tipo)) {
            return ['mythic', 'legendary', 'epic', 'rare'].includes(r.rareza);
        }

        return ['supercharger', 'evolution', 'perkup', 'elemental', 'reperk', 'ore', 'llama'].includes(r.tipo);
    });

    const unicas = [];
    const vistos = new Set();

    for (const recompensa of valiosas) {
        const clave = String(recompensa.nombre || '').trim().toLowerCase();
        if (!clave || vistos.has(clave)) continue;
        vistos.add(clave);
        unicas.push(recompensa.nombre);
    }

    return unicas;
}

function formatearMultiplicadorSTW(item) {
    const multiplicador = Number(item.multiplicadorRecompensa);
    if (multiplicador === 4) return '✖️ *Recompensa x4:* Sí\n';
    if (multiplicador === 5) return '✖️ *Recompensa x5:* Sí\n';
    return '';
}

function formatearAlertaSTW(item, encabezado = '') {
    let texto = '';

    if (encabezado) texto += encabezado + '\n';
    texto += `⚡ *PL:* ${item.pl}\n`;
    if (item.zona) texto += `🌍 *Zona:* ${item.zona}\n`;

    texto += formatearMultiplicadorSTW(item);

    if (item.mision) {
        texto += `🎯 *Misión:* ${item.mision}\n`;
    }

    const recompensas = obtenerRecompensasValiosasSTW(item);
    if (recompensas.length > 0) {
        texto += `🎁 *Recompensa:* ${recompensas.join(' | ')}\n`;
    }

    texto += '\n';
    return texto;
}

async function alertasSTW(sock, chatId, msg, categoria = 'todas') {
    const datos = await obtenerAlertasSTW();
    const fechaHoy = obtenerFechaActual();
    const lineasPavos = [`📅 _${fechaHoy}_`, ''];

    // PaVos: construir el mensaje por líneas para garantizar saltos reales.
    if (categoria === 'pavos' || categoria === 'todas') {
        lineasPavos.push('🎮 *ALERTAS DE PAVOS*');

        if (datos.pavos.length === 0) {
            lineasPavos.push('_No hay alertas de pavos registradas._', '');
        } else {
            let totalPavos = 0;

            datos.pavos.forEach(p => {
                totalPavos += p.cantidad || 50;
                lineasPavos.push(
                    `⚡ *PL:* ${p.pl}`,
                    `🎯 *Misión:* ${p.mision}`,
                    `🪙 *PaVos:* ${p.cantidad || 50}`,
                    ''
                );
            });

            lineasPavos.push(`💰 *Total del día:* ${totalPavos} paVos`, '');
        }
    }

    let texto = lineasPavos.join('\n');

    // El resto de alertas se agrega al mismo mensaje.
    

    if (categoria === 'epicas' || (categoria === 'todas' && datos.epicas.length > 0)) {
        texto += `🟣 *ALERTAS ÉPICAS*\n`;
        if (datos.epicas.length === 0) {
            texto += `_No hay alertas épicas registradas._\n\n`;
        } else {
            datos.epicas.forEach(e => {
                texto += formatearAlertaSTW(e);
            });
        }
    }

    if (categoria === 'legendarias' || (categoria === 'todas' && datos.legendarias.length > 0)) {
        texto += `🌟 *ALERTAS LEGENDARIAS*\n`;
        if (datos.legendarias.length === 0) {
            texto += `_No hay alertas legendarias registradas._\n\n`;
        } else {
            datos.legendarias.forEach(L => {
                texto += formatearAlertaSTW(L);
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
        const listaPlAltas = datos.plAltas || [];

        if (listaPlAltas.length === 0) {
            texto += `_No hay alertas destacadas registradas en este momento._\n\n`;
        } else {
            listaPlAltas.forEach(item => {
                texto += formatearAlertaSTW(item, '⭐ *ALERTA DESTACADA*');
            });
        }
    } catch (e) {
        texto += `_Error al cargar las alertas destacadas._\n\n`;
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
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
                    mensajeAuto += formatearAlertaSTW(L);
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
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias
};
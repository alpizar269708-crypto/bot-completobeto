const { esProgramadorBot } = require('./programadorbot');
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
    if (msg.key.fromMe || esProgramadorBot(msg)) return true;
    
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

async function obtenerAlertasSTW(actualizarEnVivo = false) {
    // Los comandos de consulta pueden pedir datos frescos de STW Planner.
    // El raspado periódico y las alertas automáticas pueden usar los datos
    // guardados para no generar peticiones innecesarias.
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
    const datos = await obtenerAlertasSTW(true);
    const fechaHoy = obtenerFechaActual();
    const lineasPavos = [`📅 _${fechaHoy}_`, ''];

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

async function comandoDestacadasSTW(sock, chatId, msg) {
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n🔥 *ALERTAS DESTACADAS — RECOMPENSAS BUENAS*\n\n`;

    try {
        const datos = await obtenerAlertasSTW(true);
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

async function comandoPreguntarAlerta(sock, chatId, msg, palabrasClave = []) {
    const datos = await obtenerAlertasSTW(true);
    const termino = Array.isArray(palabrasClave)
        ? palabrasClave.join(' ').trim()
        : String(palabrasClave || '').trim();

    if (!termino) {
        await sock.sendMessage(chatId, { text: '🤖 Escribe después de *alerta* una palabra o frase para buscar en las alertas.' }, { quoted: msg });
        return;
    }

    const normalizarTexto = texto => String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const partesBusqueda = termino.split(/\s+/).filter(Boolean);
    const terminoPL = partesBusqueda.join('').toLowerCase();
    const rangoPL = terminoPL.match(/^pl(\d+)-(\d+)$/);
    const plSeparado = partesBusqueda.length === 2
        && normalizarTexto(partesBusqueda[0]) === 'pl'
        && /^\d+(?:-\d+)?$/.test(partesBusqueda[1]);

    const esBusquedaPL = Boolean(rangoPL || /^pl\d+$/.test(terminoPL) || plSeparado);

    const plMinimo = esBusquedaPL
        ? Number(rangoPL ? rangoPL[1] : (partesBusqueda.length === 1 ? terminoPL.replace(/^pl/, '') : partesBusqueda[1].split('-')[0]))
        : null;
    const plMaximo = esBusquedaPL
        ? Number(rangoPL ? rangoPL[2] : (partesBusqueda.length === 1 ? terminoPL.replace(/^pl/, '') : partesBusqueda[1].split('-')[1] || partesBusqueda[1]))
        : null;
    const clave = normalizarTexto(termino);

    const coincidencias = [
        ...datos.pavos.map(item => ({ ...item, categoria: 'PaVos' })),
        ...datos.epicas.map(item => ({ ...item, categoria: 'Épicas' })),
        ...datos.legendarias.map(item => ({ ...item, categoria: 'Legendarias' })),
        ...(datos.plAltas || []).map(item => ({ ...item, categoria: 'Destacadas' }))
    ].filter(item => {
        if (esBusquedaPL) {
            const plItem = Number(String(item.pl || '').replace(/[^0-9]/g, ''));
            return plItem >= Math.min(plMinimo, plMaximo) && plItem <= Math.max(plMinimo, plMaximo);
        }

        const textoBusqueda = normalizarTexto([
            item.mision,
            item.zona,
            item.nombre,
            item.recompensa,
            ...(Array.isArray(item.recompensas) ? item.recompensas : [])
        ].filter(Boolean).join(' '));

        return textoBusqueda.includes(clave);
    });

    const etiquetaPL = plMinimo === plMaximo
        ? String(plMinimo)
        : Math.min(plMinimo, plMaximo) + '-' + Math.max(plMinimo, plMaximo);

    let texto = esBusquedaPL
        ? '🔎 *ALERTAS CON PL ' + etiquetaPL + '*\n\n'
        : '🔎 *ALERTAS QUE CONTIENEN:* ' + termino + '\n\n';

    if (coincidencias.length === 0) {
        texto += esBusquedaPL
            ? '_No encontré alertas con PL ' + etiquetaPL + '._\n\n'
            : '_No encontré alertas que contengan esa palabra o frase._\n\n';
    } else {
        coincidencias.forEach(item => {
            texto += '📌 *' + item.categoria + '*\n';
            texto += formatearAlertaSTW(item);
        });
    }

    texto += 'Support-a-Creator: *JASC13* ❤️';
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}
async function enviarAlertaPavosAutomatica(sock, enviarAunqueNoHayaPavos = false, actualizarEnVivo = false) {
    try {
        const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
        if (!configChat || !configChat.valor) return false;

        let grupos = [];
        try {
            grupos = JSON.parse(configChat.valor);
            if (!Array.isArray(grupos)) grupos = [configChat.valor];
        } catch (e) {
            // Compatibilidad con la configuración antigua de un solo grupo.
            grupos = [configChat.valor];
        }

        grupos = [...new Set(grupos.filter(id => typeof id === 'string' && id.endsWith('@g.us')))];
        if (grupos.length === 0) return false;

        // Solo el intento inicial de las 18:02 hace el raspado diario.
        // Los reintentos usan los datos ya guardados para no volver a consultar STW Planner.
        if (actualizarEnVivo) {
            try {
                const { extraerAlertasAPI } = require('../webBridge');
                await extraerAlertasAPI();
            } catch (e) {
                console.error('⚠️ No se pudo hacer el raspado diario de STW Planner:', e.message);
            }
        }

        const datos = await obtenerAlertasSTW(false);

        // La primera alerta de las 6:02 PM siempre se envía, haya o no PaVos.
        // En los reintentos solo se envía cuando aparecen PaVos.
        if (datos.pavos.length === 0) {
            if (enviarAunqueNoHayaPavos) {
                const mensajeSinPavos = '🎮 *ALERTAS DE PAVOS — 6:02 PM*\\n\\n_No hay alertas de pavos registradas._\\n\\nSupport-a-Creator: *JASC13* ❤️';
                for (const grupo of grupos) {
                    try {
                        await sock.sendMessage(grupo, { text: mensajeSinPavos });
                    } catch (e) {
                        console.error(`Error enviando alerta automática a ${grupo}:`, e.message);
                    }
                }
                return false;
            }
            return false;
        }

        const total = datos.pavos.reduce((acc, p) => acc + (p.cantidad || 50), 0);
        let mensajeAuto = `🎮 *ALERTAS DE PAVOS — 6:02 PM*\n\n`;

        datos.pavos.forEach(p => {
            mensajeAuto += `⚡ *PL:* ${p.pl}\n🎯 *Misión:* ${p.mision}\n🪙 *PaVos:* ${p.cantidad || 50}\n\n`;
        });

        mensajeAuto += `💰 *Total del día:* ${total} paVos\n\n`;
        mensajeAuto += `Support-a-Creator: *JASC13* ❤️`;

        for (const grupo of grupos) {
            try {
                await sock.sendMessage(grupo, { text: mensajeAuto });
            } catch (e) {
                console.error(`Error enviando alerta automática a ${grupo}:`, e.message);
            }
        }

        return true;
    } catch (error) {
        console.error('Error en alerta automática de PaVos:', error.message);
        return false;
    }
}

function iniciarCronAlertasDiarias(sock) {
    cron.schedule('2 18 * * *', async () => {
        // Hora de México: 18:02, 18:03:30, 18:05:00, 18:06:30,
        // 18:08:00, 18:09:30 y 18:11:00.
        const intervaloReintentoMs = 90 * 1000;
        const limiteMs = 9 * 60 * 1000;
        const inicio = Date.now();

        const enviado = await enviarAlertaPavosAutomatica(sock, true, true);
        if (enviado) return;

        const reintentar = async () => {
            const transcurrido = Date.now() - inicio;
            if (transcurrido > limiteMs) return;

            const seEnvio = await enviarAlertaPavosAutomatica(sock);
            if (seEnvio) return;

            if (Date.now() - inicio < limiteMs) {
                setTimeout(reintentar, intervaloReintentoMs);
            }
        };

        setTimeout(reintentar, intervaloReintentoMs);
    }, { scheduled: true, timezone: "America/Mexico_City" });
}
async function activarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;

    const configActual = await Config.findOne({ clave: 'chat_alertas_diarias' });
    let grupos = [];

    if (configActual?.valor) {
        try {
            const parsed = JSON.parse(configActual.valor);
            grupos = Array.isArray(parsed) ? parsed : [configActual.valor];
        } catch (e) {
            grupos = [configActual.valor];
        }
    }

    grupos = [...new Set(grupos.filter(id => typeof id === 'string' && id.endsWith('@g.us')))];

    if (grupos.includes(chatId)) {
        await sock.sendMessage(chatId, {
            text: 'ℹ️ *Este grupo ya se encuentra activado para las alertas de PaVos.*\n\n📅 Seguirán recibiendo la alerta automática todos los días a las *6:02 PM* (hora de Ciudad de México).'
        }, { quoted: msg });
        return;
    }

    grupos.push(chatId);
    await Config.findOneAndUpdate(
        { clave: 'chat_alertas_diarias' },
        { valor: JSON.stringify(grupos) },
        { upsert: true }
    );

    await sock.sendMessage(chatId, {
        text: `✅ *Alertas de PaVos activadas en este grupo.*\n\n📅 Recibirán la alerta automática todos los días a las *6:02 PM* (hora de Ciudad de México).\n🪙 El aviso contendrá *únicamente las alertas de PaVos*.`
    }, { quoted: msg });
}

async function desactivarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;

    let grupos = await leerConfigJSON('chat_alertas_diarias');
    grupos = grupos.filter(id => id !== chatId);

    if (grupos.length === 0) {
        await Config.findOneAndDelete({ clave: 'chat_alertas_diarias' });
    } else {
        await Config.findOneAndUpdate(
            { clave: 'chat_alertas_diarias' },
            { valor: JSON.stringify(grupos) },
            { upsert: true }
        );
    }

    await sock.sendMessage(chatId, { text: `🔕 *Alertas de PaVos desactivadas en este grupo.*` }, { quoted: msg });
}

module.exports = { 
    obtenerAlertasSTW, alertasSTW, comandoDestacadasSTW, comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias
};
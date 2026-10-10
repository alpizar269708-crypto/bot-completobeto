const cron = require('node-cron');
const { Config } = require('../database/modelos');
const { esPrivilegiadoTotalAsync } = require('../utils/whatsapp');

function obtenerFechaActual() {
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

async function esAdminValido(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: `❌ Este comando solo se puede usar en grupos.` }, { quoted: msg });
        return false;
    }
    if (msg.key.fromMe || await esPrivilegiadoTotalAsync(sock, msg.key.participant || msg.key.remoteJid)) return true;
    
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

async function obtenerAlertasSTW(actualizarEnVivo = false, progreso = null) {
    const informar = async (texto) => { if (typeof progreso === 'function') await progreso(texto); };
    const inicioDiagnostico = Date.now();
    await informar('🔬 ETAPA 1/6 — Preparando lectura de alertas STW. Actualización en vivo solicitada=' + Boolean(actualizarEnVivo) + '; raspado suspendido temporalmente.');
    // PAUSA TEMPORAL DEL RASPADO STW PLANNER:
    // Tanto los comandos como las alertas programadas leen solo el caché de MongoDB.
    // No descargar páginas ni ejecutar parsers mientras se estabiliza el arranque.
    await informar('⏸️ ETAPA 2/6 — Raspado de STW Planner temporalmente suspendido; se utilizarán únicamente datos guardados en MongoDB.');

    await informar('🗄️ ETAPA 3/6 — Leyendo cuatro listas guardadas en MongoDB: PaVos, épicas, legendarias y PL altas.');
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

    await informar('📦 ETAPA 4/6 — Lectura de base de datos completa: PaVos=' + scrapePavos.length + ', épicas=' + scrapeEpicas.length + ', legendarias=' + scrapeLegendarias.length + ', PL altas=' + scrapePlAltas.length + '.');

    // Desde ahora STW Planner es la única fuente de alertas automáticas.
    // Las listas manuales antiguas ya no se mezclan para evitar duplicados.
    const plAltasLimpias = deduplicarPlAltasVbucks(scrapePlAltas);
    await informar('🧹 ETAPA 5/6 — Deduplicación de PL altas: ' + scrapePlAltas.length + ' → ' + plAltasLimpias.length + '.');
    await informar('✅ ETAPA 6/6 — Datos listos para formatear; duración=' + ((Date.now() - inicioDiagnostico) / 1000).toFixed(2) + ' s.');
    return {
        pavos: scrapePavos,
        epicas: scrapeEpicas,
        legendarias: scrapeLegendarias,
        plAltas: plAltasLimpias
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

async function alertasSTW(sock, chatId, msg, categoria = 'todas', progreso = null) {
    const informar = async (texto) => { if (typeof progreso === 'function') await progreso(texto); };
    await informar('🧭 Comando alertasSTW iniciado. Categoría solicitada=' + categoria + '.');
    const datos = await obtenerAlertasSTW(categoria === 'pavos', informar);
    await informar('🧮 ETAPA FINAL — Preparando respuesta: PaVos=' + datos.pavos.length + ', épicas=' + datos.epicas.length + ', legendarias=' + datos.legendarias.length + ', destacadas=' + (datos.plAltas || []).length + '.');
    const fechaHoy = obtenerFechaActual();
    const lineasPavos = [`📅 _${fechaHoy}_`, '', '🎮 *ALERTAS DE PAVOS*', ''];

    if (categoria === 'pavos' || categoria === 'todas') {
        
        if (datos.pavos.length === 0) {
            lineasPavos.push('*No hay alertas de pavos registradas* 💔');
            lineasPavos.push('', '');
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

async function comandoDestacadasSTW(sock, chatId, msg, progreso = null) {
    const informar = async (texto) => { if (typeof progreso === 'function') await progreso(texto); };
    await informar('🧭 Comando de destacadas iniciado; consultará caché STW Planner y filtrará PL altas.');
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n🔥 *ALERTAS DESTACADAS — RECOMPENSAS BUENAS*\n\n`;

    try {
        await informar('🗄️ ETAPA 1/4 — Leyendo datos guardados en MongoDB.');
        const datos = await obtenerAlertasSTW(false, informar);
        await informar('🔎 ETAPA 2/4 — Seleccionando alertas destacadas de PL altas. Total recibido=' + (datos.plAltas || []).length + '.');
        const listaPlAltas = datos.plAltas || [];

        await informar('🧹 ETAPA 3/4 — Lista seleccionada; elementos a formatear=' + listaPlAltas.length + '.');
        if (listaPlAltas.length === 0) {
            texto += `_No hay alertas destacadas registradas en este momento._\n\n`;
        } else {
            listaPlAltas.forEach(item => {
                texto += formatearAlertaSTW(item, '⭐ *ALERTA DESTACADA*');
            });
        }
    } catch (e) {
        await informar('❌ FALLÓ comandoDestacadasSTW: ' + String(e.stack || e.message || e).slice(0, 900));
        texto += `_Error al cargar las alertas destacadas._\n\n`;
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await informar('✅ ETAPA 4/4 — Respuesta de destacadas construida; enviando a WhatsApp.');
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg, palabrasClave = [], progreso = null) {
    const informar = async (texto) => { if (typeof progreso === 'function') await progreso(texto); };
    await informar('🧭 Búsqueda de recompensa iniciada; término=' + (Array.isArray(palabrasClave) ? palabrasClave.join(' ') : String(palabrasClave || '')) + '.');
    const datos = await obtenerAlertasSTW(false, informar);
    await informar('🔎 ETAPA 1/3 — Datos cargados; combinando PaVos, épicas, legendarias y destacadas para buscar coincidencias.');
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

    await informar('🧮 ETAPA 2/3 — Búsqueda terminada; coincidencias=' + coincidencias.length + '.');
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
    await informar('✅ ETAPA 3/3 — Resultado construido; enviando respuesta a WhatsApp.');
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}
async function enviarAlertaPavosAutomatica(sock, actualizarEnVivo = false, horaAlerta = '6:01:30 PM', avisarSinPavos = false) {
    try {
        const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
        if (!configChat || !configChat.valor) return false;

        let grupos = [];
        try {
            grupos = JSON.parse(configChat.valor);
            if (!Array.isArray(grupos)) grupos = [configChat.valor];
        } catch (e) {
            grupos = [configChat.valor];
        }

        grupos = [...new Set(grupos.filter(id => typeof id === 'string' && id.endsWith('@g.us')))];
        if (grupos.length === 0) return false;

        // PAUSA TEMPORAL: los horarios programados tampoco raspan STW Planner.
        // Usan únicamente el caché ya guardado en MongoDB.
        const datos = await obtenerAlertasSTW(false);

        // El primer intento informa aunque no encuentre PaVos; los siguientes solo avisan si encuentran.
        if (!datos.pavos.length) {
            if (avisarSinPavos) {
                const mensajeSinPavos = `🎮 *ALERTAS DE PAVOS — ${horaAlerta}*\n\n😔 No hubo PaVos en este raspado.\n\n🔎 Seguiré revisando a las 6:02 PM y 6:05 PM.`;
                for (const grupo of grupos) {
                    try {
                        await sock.sendMessage(grupo, { text: mensajeSinPavos });
                    } catch (e) {
                        console.error(`Error enviando aviso sin PaVos a ${grupo}:`, e.message);
                    }
                }
            }
            return false;
        }

        const total = datos.pavos.reduce((acc, p) => acc + (p.cantidad || 50), 0);
        let mensajeAuto = `🎮 *ALERTAS DE PAVOS — ${horaAlerta}*\n\n`;

        datos.pavos.forEach(p => {
            mensajeAuto += `⚡ *PL:* ${p.pl}\n🎯 *Misión:* ${p.mision}\n🪙 *PaVos:* ${p.cantidad || 50}\n\n`;
        });

        mensajeAuto += `💰 *Total del día:* ${total} paVos\n\n`;
        mensajeAuto += `Support-a-Creator: *JASC13* ❤️`;

        let enviadaAlMenosAUnGrupo = false;
        for (const grupo of grupos) {
            try {
                await sock.sendMessage(grupo, { text: mensajeAuto });
                enviadaAlMenosAUnGrupo = true;
            } catch (e) {
                console.error(`Error enviando alerta automática a ${grupo}:`, e.message);
            }
        }

        return enviadaAlMenosAUnGrupo;
    } catch (error) {
        console.error('Error en alerta automática de PaVos:', error.message);
        return false;
    }
}

const CLAVE_ESTADO_ALERTA_PAVOS = 'stw_pavos_alerta_diaria_estado';
let cronAlertasDiariasIniciado = false;
let raspadoEnCurso = false;

function fechaCDMX() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

async function yaSeEnvioAlertaPavosHoy(hoy) {
    try {
        const doc = await Config.findOne({ clave: CLAVE_ESTADO_ALERTA_PAVOS });
        if (!doc?.valor) return false;
        const estado = JSON.parse(doc.valor);
        return estado?.fecha === hoy && estado?.enviada === true;
    } catch (e) {
        console.error('⚠️ No se pudo leer el estado diario de PaVos:', e.message);
        return false;
    }
}

async function guardarAlertaPavosEnviada(hoy, horario) {
    await Config.findOneAndUpdate(
        { clave: CLAVE_ESTADO_ALERTA_PAVOS },
        { valor: JSON.stringify({ fecha: hoy, enviada: true, horario, actualizadoEn: new Date().toISOString() }) },
        { upsert: true }
    );
}

function iniciarCronAlertasDiarias(sock) {
    if (cronAlertasDiariasIniciado) {
        console.log('ℹ️ El cron diario de PaVos ya estaba iniciado; no se duplicarán horarios.');
        return;
    }
    cronAlertasDiariasIniciado = true;

    const zonaHoraria = 'America/Mexico_City';
    const horarios = [
        { cron: '30 1 18 * * *', etiqueta: '6:01:30 PM', avisarSinPavos: true },
        { cron: '0 2 18 * * *', etiqueta: '6:02 PM', avisarSinPavos: false },
        { cron: '0 5 18 * * *', etiqueta: '6:05 PM', avisarSinPavos: false }
    ];

    for (const horario of horarios) {
        cron.schedule(horario.cron, async () => {
            const hoy = fechaCDMX();
            if (raspadoEnCurso) {
                console.log(`⏭️ Se omite ${horario.etiqueta}: ya hay un raspado en curso.`);
                return;
            }

            try {
                if (await yaSeEnvioAlertaPavosHoy(hoy)) {
                    console.log(`⏭️ Se omite el raspado de las ${horario.etiqueta}: ya se envió una alerta con PaVos hoy.`);
                    return;
                }

                raspadoEnCurso = true;
                const enviada = await enviarAlertaPavosAutomatica(sock, true, horario.etiqueta, horario.avisarSinPavos);
                if (enviada) {
                    await guardarAlertaPavosEnviada(hoy, horario.etiqueta);
                    console.log(`✅ PaVos encontrados y alerta enviada a las ${horario.etiqueta}; estado guardado en MongoDB para evitar duplicados tras reinicios.`);
                } else {
                    console.log(`🔎 ${horario.etiqueta}: no se enviaron PaVos; se continuará con el siguiente horario si queda alguno.`);
                }
            } catch (e) {
                console.error(`❌ Error en el horario ${horario.etiqueta}:`, e.message);
            } finally {
                raspadoEnCurso = false;
            }
        }, { scheduled: true, timezone: zonaHoraria });
    }

    console.log('🕒 Alertas de PaVos programadas a las 18:01:30, 18:02 y 18:05 (hora de Ciudad de México). El primer horario siempre envía un aviso.');
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
            text: 'ℹ️ *Este grupo ya se encuentra activado para las alertas de PaVos.*\n\n📅 Seguirán recibiendo la alerta automática todos los días a las *6:01:30 PM, 6:02 PM y 6:05 PM* (hora de Ciudad de México).'
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
        text: `✅ *Alertas de PaVos activadas en este grupo.*\n\n📅 Recibirán la alerta automática todos los días a las *6:01:30 PM, 6:02 PM y 6:05 PM* (hora de Ciudad de México).\n🪙 A las *6:01:30 PM* se avisará aunque no haya PaVos; si no hay, se volverá a revisar a las *6:02 PM* y *6:05 PM*.`
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

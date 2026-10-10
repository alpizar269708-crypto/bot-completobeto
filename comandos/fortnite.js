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

async function obtenerAlertasSTW(actualizarEnVivo = false, progreso = null, opciones = {}) {
    let raspadoCorrecto = false;
    let fuentes = null;
    if (actualizarEnVivo) {
        try {
            const { extraerAlertasAPI } = require('../webBridge');
            const resultado = await extraerAlertasAPI(progreso, opciones);
            raspadoCorrecto = Boolean(resultado && resultado.ok === true);
            fuentes = resultado && resultado.fuentes ? resultado.fuentes : null;
            if (!raspadoCorrecto) console.warn('STW: las fuentes web no entregaron datos completos; se intentará usar el último caché válido.');
        } catch (error) {
            console.error('No se pudo actualizar STW:', error.stack || error.message);
        }
    }

    // Una consulta en vivo fallida no debe reciclar alertas antiguas como si fueran actuales.
    if (actualizarEnVivo && !raspadoCorrecto) {
        return {
            pavos: [],
            epicas: [],
            legendarias: [],
            plAltas: [],
            errorActualizacion: true,
            fuentes: fuentes || { principal: [], secundaria: [], tercera: [] }
        };
    }

    const [scrapePavos, scrapeEpicas, scrapeLegendarias, scrapePlAltas] = await Promise.all([
        leerConfigJSON('stw_pavos_scrapeados'),
        leerConfigJSON('stw_epicas_scrapeadas'),
        leerConfigJSON('stw_legendarias_scrapeadas'),
        leerConfigJSON('stw_plaltas_scrapeadas')
    ]);
    const hayCache = scrapePavos.length + scrapeEpicas.length + scrapeLegendarias.length + scrapePlAltas.length > 0;
    return {
        pavos: scrapePavos,
        epicas: scrapeEpicas,
        legendarias: scrapeLegendarias,
        plAltas: deduplicarPlAltasVbucks(scrapePlAltas),
        errorActualizacion: actualizarEnVivo && !raspadoCorrecto && !hayCache,
        fuentes
    };
}


function normalizarRecompensaSalidaSTW(recompensa) {
    if (!recompensa) return '';
    const tipo = String(recompensa.tipo || '').toLowerCase();
    if (tipo === 'vbucks') {
        const cantidad = Number(recompensa.cantidad || recompensa.cantidadVbucks || 0);
        return cantidad > 0 ? '🪙 ' + cantidad + ' PaVos' : '🪙 PaVos';
    }
    if (tipo === 'perkup') {
        const rareza = String(recompensa.rareza || '').toLowerCase();
        const icono = rareza === 'legendary' ? '🟠' : rareza === 'epic' ? '🟣' : rareza === 'mythic' ? '🟡' : '⚪';
        const rarezaEs = rareza === 'legendary' ? 'legendario' : rareza === 'epic' ? 'épico' : rareza === 'mythic' ? 'mítico' : '';
        const cantidad = Number(recompensa.cantidad || 0) ||
            Number((String(recompensa.nombre || '').match(/[x×]\s*(\d+)/i) || [])[1] || 0);
        return icono + ' Perk-Up' + (rarezaEs ? ' ' + rarezaEs : '') + (cantidad > 0 ? ' ×' + cantidad : '');
    }
    const traductores = traductoresSTW();
    if (typeof traductores.normalizarRecompensaSTW === 'function') {
        return traductores.normalizarRecompensaSTW(recompensa.raw || recompensa.nombre || '', recompensa.rareza, tipo);
    }
    return String(recompensa.nombre || recompensa.raw || '').trim();
}

function obtenerRecompensasValiosasSTW(item) {
    const recompensas = Array.isArray(item.recompensas) ? item.recompensas : [];
    const rarezasPerkUp = new Set(recompensas.filter(r => r && String(r.tipo || '').toLowerCase() === 'perkup').map(r => String(r.rareza || '').toLowerCase()));
    const tienePerkUpDoble = rarezasPerkUp.has('epic') && rarezasPerkUp.has('legendary');
    const valiosas = recompensas.filter(r => {
        if (!r || !r.tipo) return false;
        const tipo = String(r.tipo || '').toLowerCase();
        const rareza = String(r.rareza || '').toLowerCase();
        if (tipo === 'vbucks') return true;
        if (tipo === 'perkup') return tienePerkUpDoble && ['epic', 'legendary'].includes(rareza);
        if (!['hero', 'survivor', 'defender', 'schematic'].includes(tipo)) return false;
        return ['mythic', 'legendary', 'epic', 'rare'].includes(rareza);
    });
    const unicas = [];
    const vistos = new Set();
    for (const recompensa of valiosas) {
        const nombre = normalizarRecompensaSalidaSTW(recompensa);
        const clave = nombre.toLowerCase();
        if (!clave || vistos.has(clave)) continue;
        vistos.add(clave);
        unicas.push(nombre);
    }
    return unicas;
}

function formatearMultiplicadorSTW() {
    return '';
}

function traductoresSTW() {
    try { return require('../webBridge'); } catch (_) { return {}; }
}

function traducirZonaSalidaSTW(zona) {
    const traductores = traductoresSTW();
    return typeof traductores.traducirZonaSTW === 'function'
        ? (traductores.traducirZonaSTW(zona) || zona || '')
        : (zona || '');
}

function traducirMisionSalidaSTW(item) {
    const traductores = traductoresSTW();
    const traducirNombre = traductores.traducirNombreMisionSTW;
    const traducirBioma = traductores.traducirBiomaSTW;
    const fuente = String(item && (item.mision || item.misionOriginal) || '').trim();
    if (!fuente || typeof traducirNombre !== 'function') return 'Misión de alerta';
    const partes = fuente.split(/\s+-\s+/);
    const nombreOriginal = partes.shift();
    const nombre = traducirNombre(nombreOriginal) || 'Misión de alerta';
    const biomaOriginal = partes.length ? partes.join(' - ') : String(item.ubicacion || '').trim();
    let bioma = biomaOriginal && typeof traducirBioma === 'function'
        ? traducirBioma(biomaOriginal)
        : biomaOriginal;
    bioma = String(bioma || '').replace(/^the\s+/i, '').replace(/\bhaunted\s+bosque\b/gi, 'Bosque embrujado').replace(/\bthe\s+/gi, '').trim();
    return [nombre, bioma && !/^zona desconocida$/i.test(bioma) ? bioma : ''].filter(Boolean).join(' - ');
}

function traducirModificadoresSalidaSTW(modificadores) {
    const traductores = traductoresSTW();
    const traducir = traductores.traducirModificadorSTW;
    const list = Array.isArray(modificadores) ? modificadores : [];
    const traducidos = list.map(x => typeof traducir === 'function' ? traducir(x) : 'Modificador de misión').filter(Boolean);
    return [...new Set(traducidos)];
}

function esRequisitoRealSTW(valor) {
    const texto = String(valor || '').trim();
    return Boolean(texto) && !/^(none|ninguno|ninguna|ning[uú]n requisito|sin requisitos|no requirements|n\/a|na|-)$/i.test(texto);
}

function traducirRequisitosSalidaSTW(valor) {
    let texto = String(valor || '').trim();
    if (!esRequisitoRealSTW(texto)) return '';
    const misiones = [
        ['Ride the Lightning', 'Monta el rayo'],
        ['Retrieve the Data', 'Recupera los datos'],
        ['Repair the Shelter', 'Repara el refugio'],
        ['Fight the Storm', 'Lucha contra la tormenta'],
        ['Evacuate the Shelter', 'Evacúa el refugio'],
        ['Deliver the Bomb', 'Entrega la bomba'],
        ['Rescue the Survivors', 'Rescata a los supervivientes'],
        ['Build the Radar', 'Construye el radar'],
        ['Destroy the Encampments', 'Destruye los campamentos'],
        ['Refuel the Homebase', 'Reabastece la base'],
        ['Trap the Storm', 'Atrapa la tormenta'],
        ['Resupply', 'Reabastecimiento']
    ];
    for (const [ingles, espanol] of misiones) texto = texto.replace(new RegExp(ingles, 'gi'), espanol);
    const zonas = [
        ['Hexsylvania Venture Zone', 'Zona de Aventuras de Hexsylvania'],
        ['Stonewood', 'Bosque Pedregoso'], ['Plankerton', 'Ciudad Tablón'],
        ['Canny Valley', 'Valle Latoso'], ['Twine Peaks', 'Cumbres Leñosas'], ['Ventures', 'Aventuras']
    ];
    for (const [ingles, espanol] of zonas) texto = texto.replace(new RegExp(ingles, 'gi'), espanol);
    texto = texto
        .replace(/\bComplete\b/gi, 'Completa')
        .replace(/\bmissions?\b/gi, 'misiones')
        .replace(/\bquests?\b/gi, 'objetivos')
        .replace(/\bsurvivors?\b/gi, 'supervivientes')
        .replace(/\bwithin\b/gi, 'en')
        .replace(/\bzone\b/gi, 'zona')
        .replace(/\ball\b/gi, 'todas las')
        .replace(/\bthe\b/gi, 'la')
        .replace(/\band\b/gi, 'y')
        .replace(/\bwith\b/gi, 'con')
        .replace(/\bwithout\b/gi, 'sin')
        .replace(/\bdefend\b/gi, 'defender')
        .replace(/\bcomplete\b/gi, 'completar')
        .replace(/\s+/g, ' ')
        .trim();
    if (/\b(?:complete|mission|missions|quest|survivor|deliver|retrieve|defend|shelter|encampments|homebase|canny valley|twine peaks|stonewood|plankerton)\b/i.test(texto)) {
        return 'Consulta los requisitos específicos de esta misión dentro del juego.';
    }
    return texto;
}

function formatearAlertaSTW(item, encabezado = '', mostrarDetalles = false) {
    let texto = '';
    if (encabezado) texto += encabezado + '\n';
    texto += '⚡ *PL:* ' + (item.pl ?? '?') + '\n';
    if (item.zona) texto += '🌍 *Zona:* ' + traducirZonaSalidaSTW(item.zona) + '\n';
    const mision = traducirMisionSalidaSTW(item);
    if (mision) texto += '🎯 *Misión:* ' + mision + '\n';
    const recompensas = obtenerRecompensasValiosasSTW(item);
    if (recompensas.length) {
        texto += '🎁 *Recompensa:* ' + recompensas.join(' | ') + '\n';
    } else if (Number(item.cantidad || item.cantidadVbucks) > 0 && /pavos|v-?bucks/i.test(String(item.recompensa || item.tipo || item.tipoAlertaTexto || ''))) {
        texto += '🎁 *Recompensa:* 🪙 ' + Number(item.cantidad || item.cantidadVbucks) + ' PaVos\n';
    }
    if (mostrarDetalles) {
        const modificadores = traducirModificadoresSalidaSTW((item.modificadores || []).filter(modificador =>
            !/(?:^|\s)x[45](?:\s|$)/i.test(String(modificador)) &&
            !/multiplicador.{0,12}x[45]|x[45].{0,12}multiplicador/i.test(String(modificador))
        )).filter(modificador => !/(?:^|\s)x[45](?:\s|$)/i.test(modificador));
        if (modificadores.length) texto += '🧩 *Modificadores:* ' + modificadores.join(', ') + '\n';
        const requisitos = traducirRequisitosSalidaSTW(item.questReqs || item.requisitos);
        if (requisitos && !/^(none|ninguno|ninguna|sin requisitos|no requirements)$/i.test(requisitos.trim())) {
            texto += '📜 *Requisitos:* ' + requisitos + '\n';
        }
    }
    return texto + '\n';
}
function formatearResumenAlertaSTW(item) {
    const recompensas = obtenerRecompensasValiosasSTW(item);
    const resumenRecompensas = recompensas.length ? ' — ' + recompensas.join(', ') : '';
    return '⭐ *' + traducirZonaSalidaSTW(item.zona || 'Zona desconocida') +
        ' · PL ' + (item.pl ?? '?') + '* — ' + traducirMisionSalidaSTW(item) + resumenRecompensas;
}


async function alertasSTW(sock, chatId, msg, categoria = 'todas', progreso = null) {
    let progresoEnviado = false;
    const informar = async () => {
        if (typeof progreso !== 'function' || progresoEnviado) return;
        progresoEnviado = true;
        try { await progreso('⏳ Preparando las alertas.'); } catch (_) {}
    };
    let datos;
    try {
        datos = await obtenerAlertasSTW(false, informar);
    } catch (error) {
        console.error('Error cargando alertas STW para comando ' + categoria + ':', error.stack || error.message);
        datos = { pavos: [], epicas: [], legendarias: [], plAltas: [], errorActualizacion: true };
    }

    const fechaHoy = obtenerFechaActual();
    const lineas = ['📅 _' + fechaHoy + '_', ''];
    if (categoria === 'pavos' || categoria === 'todas') {
        lineas.push('🎮 *ALERTAS DE PAVOS*', '');
        if (!datos.pavos.length) {
            lineas.push(datos.errorActualizacion
                ? '⚠️ _No pude obtener alertas en vivo y todavía no hay caché guardado._'
                : '😔 _No hay alertas de PaVos registradas en este momento._', '', '');
        } else {
            let totalPavos = 0;
            for (const p of datos.pavos) {
                const cantidad = Number(p.cantidad || p.cantidadVbucks || 50);
                totalPavos += cantidad;
                lineas.push(
                    '🌍 *Zona:* ' + traducirZonaSalidaSTW(p.zona || 'Desconocida'),
                    '⚡ *PL:* ' + (p.pl ?? '?'),
                    '🎯 *Misión:* ' + traducirMisionSalidaSTW(p),
                    '🪙 *PaVos:* ' + cantidad,
                    ''
                );
            }
            lineas.push('💰 *Total del día:* ' + totalPavos + ' PaVos', '');
        }
    }

    if (categoria === 'todas') {
        lineas.push('⭐ *RESUMEN DE ALERTAS DESTACADAS*', '');
        const lista = (datos.plAltas || []).filter(item => {
            const recompensas = Array.isArray(item.recompensas) ? item.recompensas : [];
            const conPavos = recompensas.some(r => r && r.tipo === 'vbucks');
            const normalValida = recompensas.some(r => r && ['hero', 'survivor', 'defender', 'schematic'].includes(r.tipo)
                && ['epic', 'legendary', 'mythic'].includes(r.rareza));
            const rarezasPerkUp = new Set(recompensas.filter(r => r && r.tipo === 'perkup').map(r => r.rareza));
            const perkUpDoble = rarezasPerkUp.has('epic') && rarezasPerkUp.has('legendary');
            return conPavos || normalValida || perkUpDoble;
        });
        const limite = 10;
        if (!lista.length) {
            lineas.push(datos.errorActualizacion
                ? '⚠️ _No pude actualizar las alertas en este momento._'
                : '_No hay recompensas destacadas disponibles en este momento._', '');
        } else {
            for (const item of lista.slice(0, limite)) lineas.push(formatearResumenAlertaSTW(item));
            if (lista.length > limite) lineas.push('', '➕ _Hay ' + (lista.length - limite) + ' destacadas más; usa *destacadasstw* para verlas todas._');
        }
        lineas.push('', '📚 _Para ver listas completas por rareza, usa *epicasstw* o *legendariasstw*._', '');
    }

    if (categoria === 'epicas' || categoria === 'legendarias') {
        const clave = categoria === 'epicas' ? 'epicas' : 'legendarias';
        const titulo = categoria === 'epicas' ? '🟣 *ALERTAS ÉPICAS ÚTILES*' : '🟠 *ALERTAS LEGENDARIAS ÚTILES*';
        const lista = datos[clave] || [];
        lineas.push(titulo + ' · ' + lista.length, '');
        if (!lista.length) {
            lineas.push(datos.errorActualizacion
                ? '⚠️ _No pude actualizar las alertas en este momento._'
                : '_No hay recompensas de esta rareza en héroes, supervivientes, defensores o esquemas._', '');
        } else {
            for (const alerta of lista) lineas.push(formatearAlertaSTW(alerta));
        }
    }

    lineas.push('Apoya a un creador: *JASC13* ❤️');
    const texto = lineas.join('\n');
    try {
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
    } catch (error) {
        console.error('No se pudo enviar la respuesta del comando STW ' + categoria + ':', error.stack || error.message);
        throw error;
    }
}
async function comandoDestacadasSTW(sock, chatId, msg, progreso = null) {
    let progresoEnviado = false;
    const informar = async () => {
        if (typeof progreso !== 'function' || progresoEnviado) return;
        progresoEnviado = true;
        try { await progreso('⏳ Preparando las alertas destacadas.'); } catch (_) {}
    };
    await informar('🔎 Preparando las alertas destacadas.');
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n🔥 *ALERTAS DESTACADAS — BUENAS RECOMPENSAS*\n\n`;

    try {
        await informar('🗄️ ETAPA 1/4 — Leyendo datos guardados en MongoDB.');
        const datos = await obtenerAlertasSTW(false, informar);
        await informar('🔎 ETAPA 2/4 — Seleccionando alertas destacadas de PL altas. Total recibido=' + (datos.plAltas || []).length + '.');
        const listaPlAltas = datos.plAltas || [];

        await informar('🧹 ETAPA 3/4 — Lista seleccionada; elementos a formatear=' + listaPlAltas.length + '.');
        if (listaPlAltas.length === 0) {
            texto += datos.errorActualizacion
                ? '_No pude actualizar las alertas en este momento._\n\n'
                : '_No hay alertas destacadas registradas en este momento._\n\n';
        } else {
            listaPlAltas.forEach(item => {
                texto += formatearAlertaSTW(item, '⭐ *ALERTA DESTACADA*');
            });
        }
    } catch (e) {
        await informar('❌ FALLÓ comandoDestacadasSTW: ' + String(e.stack || e.message || e).slice(0, 900));
        texto += `_Error al cargar las alertas destacadas._\n\n`;
    }

    texto += `Apoya a un creador: *JASC13* ❤️`;
    await informar('✅ ETAPA 4/4 — Respuesta de destacadas construida; enviando a WhatsApp.');
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg, palabrasClave = [], progreso = null, mostrarDetalles = false) {
    let progresoEnviado = false;
    const informar = async () => {
        if (typeof progreso !== 'function' || progresoEnviado) return;
        progresoEnviado = true;
        try { await progreso('⏳ Buscando alertas.'); } catch (_) {}
    };
    const nombreComando = mostrarDetalles ? 'alertanov' : 'alerta';
    const termino = Array.isArray(palabrasClave)
        ? palabrasClave.join(' ').trim()
        : String(palabrasClave || '').trim();

    if (!termino) {
        await sock.sendMessage(chatId, { text: '🤖 Escribe después de *' + nombreComando + '* una palabra o frase para buscar en las alertas.' }, { quoted: msg });
        return;
    }

    await informar('🔎 Iniciando búsqueda de alertas.');
    const datos = await obtenerAlertasSTW(false, informar, mostrarDetalles ? { exhaustivo: true } : {});
    await informar('🔎 Datos de alertas cargados; buscando coincidencias.');
    const hayDatosDisponibles = datos.pavos.length + datos.epicas.length + datos.legendarias.length + (datos.plAltas || []).length > 0;
    if (datos.errorActualizacion && !hayDatosDisponibles) {
        await sock.sendMessage(chatId, { text: '⚠️ No pude actualizar las alertas y no hay datos guardados para buscar. Inténtalo de nuevo en un momento.' }, { quoted: msg });
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

    const coincidenciasFiltradas = [
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
            item.mision, item.misionOriginal, item.zona, item.nombre, item.recompensa,
            ...(Array.isArray(item.recompensas) ? item.recompensas.map(r => typeof r === 'string' ? r : (r.nombre || r.raw || '')) : []),
            item.cantidad, item.cantidadVbucks, item.tipoAlertaTexto
        ].filter(Boolean).join(' '));
        return textoBusqueda.includes(clave);
    });

    const mapaCoincidencias = new Map();
    for (const item of coincidenciasFiltradas) {
        const normalizarClave = valor => normalizarTexto(valor).replace(/\s+/g, ' ').trim();
        const traductores = traductoresSTW();
        const original = String(item.misionOriginal || '').trim();
        const nombreBase = original && typeof traductores.traducirNombreMisionSTW === 'function'
            ? traductores.traducirNombreMisionSTW(original)
            : String(item.mision || '').split(/\s+-\s+/)[0].trim();
        const claveMision = [normalizarClave(item.zona), Number(item.pl || 0), normalizarClave(nombreBase)].join('|');
        const anterior = mapaCoincidencias.get(claveMision);
        if (!anterior) {
            mapaCoincidencias.set(claveMision, {
                ...item, categoria: [item.categoria],
                recompensas: [...(item.recompensas || [])],
                modificadores: [...(item.modificadores || [])]
            });
            continue;
        }
        const categorias = [...new Set([...(Array.isArray(anterior.categoria) ? anterior.categoria : [anterior.categoria]), item.categoria])];
        const recompensas = [...(anterior.recompensas || [])];
        const claveRecompensa = r => typeof r === 'string' ? r.toLowerCase() : [r.tipo, r.rareza, r.raw || r.nombre].join('|').toLowerCase();
        const clavesRecompensa = new Set(recompensas.map(claveRecompensa));
        for (const recompensa of (item.recompensas || [])) {
            const k = claveRecompensa(recompensa);
            if (!clavesRecompensa.has(k)) { clavesRecompensa.add(k); recompensas.push(recompensa); }
        }
        const modificadores = [...new Set([...(anterior.modificadores || []), ...(item.modificadores || [])])];
        mapaCoincidencias.set(claveMision, {
            ...anterior, ...item, categoria: categorias, recompensas, modificadores,
            recompensa: recompensas.map(r => typeof r === 'string' ? r : r.nombre).filter(Boolean).join(' | ') || item.recompensa || anterior.recompensa,
            questReqs: anterior.questReqs || item.questReqs, requisitos: anterior.requisitos || item.requisitos
        });
    }
    const coincidencias = Array.from(mapaCoincidencias.values());
    const etiquetaPL = plMinimo === plMaximo
        ? String(plMinimo)
        : Math.min(plMinimo, plMaximo) + '-' + Math.max(plMinimo, plMaximo);

    let texto = esBusquedaPL
        ? '🔎 *ALERTAS CON PL ' + etiquetaPL + '*\n\n'
        : '🔎 *ALERTAS QUE CONTIENEN:* ' + termino + '\n\n';

    await informar('🔎 Búsqueda terminada; coincidencias=' + coincidencias.length + '.');
    if (coincidencias.length === 0) {
        texto += esBusquedaPL
            ? '_No encontré alertas con PL ' + etiquetaPL + '._\n\n'
            : '_No encontré alertas que contengan esa palabra o frase._\n\n';
    } else {
        coincidencias.forEach(item => {
            const categorias = Array.isArray(item.categoria) ? item.categoria : [item.categoria];
            texto += '📌 *' + [...new Set(categorias)].join(' / ') + '*\n';
            texto += formatearAlertaSTW(item, '', mostrarDetalles);
        });
    }

    texto += 'Apoya a un creador: *JASC13* ❤️';
    await informar('✅ Búsqueda terminada.');
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}
function claveMisionAlertaDiaria(item) {
    const normalizar = valor => String(valor || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return [normalizar(item.zona), String(item.pl ?? ''), normalizar(item.misionOriginal || item.mision), normalizar(item.ubicacion)].join('|');
}

function firmaMisionAlertaDiaria(item) {
    const recompensas = (item.recompensas || []).map(r =>
        [r.tipo || '', r.rareza || '', String(r.raw || r.nombre || ''), Number(r.cantidad || 0)].join(':')
    ).sort();
    return JSON.stringify([item.pl, item.zona, item.misionOriginal || item.mision, item.ubicacion, recompensas]);
}

function firmasPorFuenteAlertaDiaria(fuentes) {
    const resultado = {};
    for (const nombre of ['principal', 'secundaria', 'tercera']) {
        resultado[nombre] = {};
        for (const item of (Array.isArray(fuentes && fuentes[nombre]) ? fuentes[nombre] : [])) {
            resultado[nombre][claveMisionAlertaDiaria(item)] = firmaMisionAlertaDiaria(item);
        }
    }
    return resultado;
}

function alertaDiariaEsUtil(item) {
    return (item.recompensas || []).some(r => r && (
        r.tipo === 'vbucks' ||
        (['hero', 'survivor', 'defender', 'schematic'].includes(r.tipo) &&
         ['mythic', 'legendary', 'epic'].includes(r.rareza)) ||
        (r.tipo === 'perkup' && ['epic', 'legendary'].includes(r.rareza))
    ));
}

function combinarAlertasDiarias(lista) {
    const mapa = new Map();
    for (const item of (Array.isArray(lista) ? lista : []).filter(alertaDiariaEsUtil)) {
        const clave = claveMisionAlertaDiaria(item);
        if (!mapa.has(clave)) {
            mapa.set(clave, { ...item, recompensas: [...(item.recompensas || [])] });
            continue;
        }
        const anterior = mapa.get(clave);
        const vistas = new Set(anterior.recompensas.map(r => [r.tipo || '', r.rareza || '', r.raw || r.nombre || ''].join('|')));
        for (const r of (item.recompensas || [])) {
            const kr = [r.tipo || '', r.rareza || '', r.raw || r.nombre || ''].join('|');
            if (!vistas.has(kr)) { vistas.add(kr); anterior.recompensas.push(r); }
        }
    }
    return Array.from(mapa.values());
}

async function enviarAlertaPavosAutomatica(sock, actualizarEnVivo = false, horaAlerta = '6:01:20 PM', avisarSinPavos = false, marcarEnviadaSiNoHayPavos = true) {
    try {
        const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
        if (!configChat || !configChat.valor) return false;
        let grupos = [];
        try {
            grupos = JSON.parse(configChat.valor);
            if (!Array.isArray(grupos)) grupos = [configChat.valor];
        } catch (_) { grupos = [configChat.valor]; }
        grupos = [...new Set(grupos.filter(id => typeof id === 'string' && id.endsWith('@g.us')))];
        if (!grupos.length) return false;

        // Nunca raspar desde el envío: se usa exclusivamente el snapshot ya guardado.
        const pavos = await leerConfigJSON('stw_pavos_scrapeados');
        const alertas = pavos.filter(item => Number(item.cantidad || item.cantidadVbucks || 0) > 0);
        if (!alertas.length) {
            if (!avisarSinPavos) return false;
            let avisoEnviado = false;
            for (const grupo of grupos) {
                try {
                    await sock.sendMessage(grupo, { text: '🎮 *ALERTAS DE PAVOS — 6:02 PM*\\n\\n_No hay alertas de pavos registradas._\\n\\nSupport-a-Creator: *JASC13* ❤️' });
                    avisoEnviado = true;
                } catch (e) {
                    console.error('Error enviando aviso de alertas vacías:', e.message);
                }
            }
            if (avisoEnviado && marcarEnviadaSiNoHayPavos) await guardarAlertaPavosEnviada(fechaCDMX(), horaAlerta, {});
            return avisoEnviado;
        }

        let mensaje = '🎮 *ALERTAS DE PaVOS — ' + horaAlerta + '*\n\n';
        let total = 0;
        for (const item of alertas) {
            const cantidad = Number(item.cantidad || item.cantidadVbucks || 0);
            total += cantidad;
            mensaje += '🌍 *Zona:* ' + traducirZonaSalidaSTW(item.zona || 'Desconocida') + '\n' +
                '⚡ *PL:* ' + (item.pl ?? '?') + '\n' +
                '🎯 *Misión:* ' + traducirMisionSalidaSTW(item) + '\n' +
                '🪙 *PaVos:* ' + cantidad + '\n\n';
        }
        mensaje += '💰 *Total del día:* ' + total + ' PaVos\n\n🔎 Usa *pavos* para consultar la información guardada.';
        let enviada = false;
        for (const grupo of grupos) {
            try {
                await sock.sendMessage(grupo, { text: mensaje });
                enviada = true;
            } catch (e) {
                console.error('Error enviando alerta diaria al grupo:', e.message);
            }
        }
        if (enviada) {
            const firmas = {};
            for (const item of alertas) firmas[claveMisionAlertaDiaria(item)] = firmaMisionAlertaDiaria(item);
            await guardarAlertaPavosEnviada(fechaCDMX(), horaAlerta, { snapshot: firmas });
        }
        return enviada;
    } catch (error) {
        console.error('Error en alerta diaria:', error.stack || error.message);
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

async function guardarAlertaPavosEnviada(hoy, horario, firmasPorFuente = {}) {
    await Config.findOneAndUpdate(
        { clave: CLAVE_ESTADO_ALERTA_PAVOS },
        { valor: JSON.stringify({ fecha: hoy, enviada: true, horario, firmasPorFuente, actualizadoEn: new Date().toISOString() }) },
        { upsert: true }
    );
}

async function enviarAvisoConsultaSTW(sock) {
    try {
        // Validación robusta con la hora real de CDMX (sin interpretar cadenas de fecha
        // en la zona horaria del servidor). Fuera de 18:01:00–18:05:59 no se envía.
        const partesHora = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Mexico_City',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date());
        const horaCDMX = Number(partesHora.find(p => p.type === 'hour')?.value);
        const minutoCDMX = Number(partesHora.find(p => p.type === 'minute')?.value);
        const segundoCDMX = Number(partesHora.find(p => p.type === 'second')?.value);
        const segundosCDMX = horaCDMX * 3600 + minutoCDMX * 60 + segundoCDMX;
        if (segundosCDMX < (18 * 3600 + 60) || segundosCDMX >= (18 * 3600 + 6 * 60)) {
            console.log('⏭️ Aviso previo STW omitido: fuera del horario permitido (18:01–18:05 CDMX).');
            return;
        }
        const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
        if (!configChat || !configChat.valor) return;
        let grupos = [];
        try {
            grupos = JSON.parse(configChat.valor);
            if (!Array.isArray(grupos)) grupos = [configChat.valor];
        } catch (_) { grupos = [configChat.valor]; }
        grupos = [...new Set(grupos.filter(id => typeof id === 'string' && id.endsWith('@g.us')))];
        for (const grupo of grupos) {
            try {
                await sock.sendMessage(grupo, { text: '⏳ Consultando, esto puede tardar unos segundos. No hace falta repetir el comando.' });
            } catch (error) {
                console.error('No se pudo enviar el aviso previo STW a ' + grupo + ':', error.message);
            }
        }
    } catch (error) {
        console.error('No se pudo preparar el aviso previo STW:', error.message);
    }
}

function iniciarCronAlertasDiarias(sock) {
    if (cronAlertasDiariasIniciado) {
        console.log('ℹ️ El cron diario de STW ya estaba iniciado; no se duplicarán horarios.');
        return;
    }
    cronAlertasDiariasIniciado = true;
    const zonaHoraria = 'America/Mexico_City';
    const clavesCacheSTW = [
        'stw_pavos_scrapeados',
        'stw_epicas_scrapeadas',
        'stw_legendarias_scrapeadas',
        'stw_plaltas_scrapeadas',
        'stw_ultima_actualizacion'
    ];

    // Vacía únicamente las cachés de alertas STW; no toca otros datos del bot.
    cron.schedule('40 59 17 * * *', async () => {
        try {
            await Config.deleteMany({ clave: { $in: clavesCacheSTW } });
            console.log('🧹 5:59:40 PM: caché de alertas STW limpiada en MongoDB.');
        } catch (error) {
            console.error('❌ No se pudo limpiar la caché STW:', error.message);
        }
    }, { scheduled: true, timezone: zonaHoraria });

    const horarios = [
        { cron: '20 1 18 * * *', etiqueta: '6:01:20 PM', ultimo: false },
        { cron: '0 2 18 * * *', etiqueta: '6:02:00 PM', ultimo: false },
        { cron: '0 5 18 * * *', etiqueta: '6:05:00 PM', ultimo: true }
    ];
    for (const horario of horarios) {
        cron.schedule(horario.cron, async () => {
            if (raspadoEnCurso) {
                console.log('⏭️ Se omite ' + horario.etiqueta + ': ya hay un raspado en curso.');
                return;
            }
            try {
                if (await yaSeEnvioAlertaPavosHoy(fechaCDMX())) {
                    console.log('⏭️ Se omite ' + horario.etiqueta + ': la alerta diaria ya se envió.');
                    return;
                }
                raspadoEnCurso = true;
                if (horario.etiqueta === '6:01:20 PM') {
                    await enviarAvisoConsultaSTW(sock);
                }
                console.log('🌐 ' + horario.etiqueta + ': iniciando raspado HTTP de STW; los comandos leerán la caché guardada.');
                const { extraerAlertasAPI } = require('../webBridge');
                const resultado = await extraerAlertasAPI();
                const pavos = await leerConfigJSON('stw_pavos_scrapeados');
                const hayPavos = resultado && resultado.ok === true &&
                    pavos.some(p => Number(p.cantidad || p.cantidadVbucks || 0) > 0);
                if (!hayPavos) {
                    console.warn('⚠️ ' + horario.etiqueta + ': no hay alertas de PaVos válidas guardadas; se enviará aviso según el horario y se conservarán los reintentos.');
                    if (horario.etiqueta === '6:01:20 PM') {
                        // Solo el primer raspado envía el mensaje de que no hay alertas; los reintentos silencian resultados vacíos.
                        await enviarAlertaPavosAutomatica(sock, false, horario.etiqueta, true, false);
                    }
                    return;
                }
                const enviada = await enviarAlertaPavosAutomatica(sock, false, horario.etiqueta, false);
                if (enviada) {
                    console.log('✅ Snapshot STW guardado en MongoDB y alerta enviada a las ' + horario.etiqueta + '.');
                } else {
                    console.log('⚠️ Había PaVos en caché, pero no se confirmó el envío; se conserva el snapshot.');
                }
            } catch (error) {
                console.error('❌ Falló el raspado de ' + horario.etiqueta + ':', error.stack || error.message);
            } finally {
                raspadoEnCurso = false;
            }
        }, { scheduled: true, timezone: zonaHoraria });
    }
    console.log('🕒 STW: borrado de caché 17:59:40; raspado 18:01:20 y reintentos 18:02:00/18:05:00 si faltan PaVos (hora CDMX).');
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
            text: 'ℹ️ *Este grupo ya se encuentra activado para las alertas de PaVos.*\n\n📅 Seguirán recibiendo la alerta automática todos los días a las *6:01:20 PM, 6:02:00 PM y 6:05:00 PM* (hora de Ciudad de México).'
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
        text: `✅ *Alertas de PaVos activadas en este grupo.*\n\n📅 Recibirán la alerta automática todos los días a las *6:01:20 PM, 6:02:00 PM y 6:05:00 PM* (hora de Ciudad de México).\n🪙 A las *6:01:20 PM* se avisará aunque no haya PaVos; si no hay, se volverá a revisar a las *6:02:00 PM* y *6:05:00 PM*.`
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
    obtenerAlertasSTW, alertasSTW, comandoDestacadasSTW, comandoPreguntarAlerta, formatearAlertaSTW, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias
};

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
            materiales: [],
            errorActualizacion: true,
            fuentes: fuentes || { principal: [], secundaria: [], tercera: [] }
        };
    }

    const [scrapePavos, scrapeEpicas, scrapeLegendarias, scrapePlAltas, scrapeMateriales, scrapeTodas] = await Promise.all([
        leerConfigJSON('stw_pavos_scrapeados'),
        leerConfigJSON('stw_epicas_scrapeadas'),
        leerConfigJSON('stw_legendarias_scrapeadas'),
        leerConfigJSON('stw_plaltas_scrapeadas'),
        leerConfigJSON('stw_materiales_evolucion_scrapeadas'),
        leerConfigJSON('stw_todas_alertas_scrapeadas')
    ]);
    const hayCache = scrapePavos.length + scrapeEpicas.length + scrapeLegendarias.length + scrapePlAltas.length + scrapeMateriales.length > 0;
    return {
        pavos: scrapePavos,
        epicas: scrapeEpicas,
        legendarias: scrapeLegendarias,
        plAltas: deduplicarPlAltasVbucks(scrapePlAltas),
        materiales: scrapeMateriales,
        errorActualizacion: actualizarEnVivo && !raspadoCorrecto && !hayCache,
        fuentes: fuentes || {
            principal: scrapeTodas.filter(item => item && item._fuenteSTW === 'principal'),
            secundaria: scrapeTodas.filter(item => item && item._fuenteSTW === 'secundaria'),
            tercera: scrapeTodas.filter(item => item && item._fuenteSTW === 'tercera')
        }
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
    let nombre = typeof traductores.normalizarRecompensaSTW === 'function'
        ? traductores.normalizarRecompensaSTW(recompensa.raw || recompensa.nombre || '', recompensa.rareza, tipo)
        : String(recompensa.nombre || recompensa.raw || '').trim();

    // Mostrar la cantidad solo cuando el extractor la obtuvo explícitamente.
    // No se inventan cantidades ni se interpreta el nivel de misión como premio.
    const cantidad = Number(recompensa.cantidad);
    if (nombre && Number.isInteger(cantidad) && cantidad > 0 &&
        !/(?:[x×]\s*\d+|\b\d+\s*(?:PaVos|V-?Bucks))\b/i.test(nombre)) {
        nombre += ' ×' + cantidad;
    }
    return nombre;
}

function obtenerRecompensasValiosasSTW(item) {
    const recompensas = Array.isArray(item.recompensas) ? item.recompensas : [];
    const rarezasPerkUp = new Set(recompensas.filter(r => r && String(r.tipo || '').toLowerCase() === 'perkup').map(r => String(r.rareza || '').toLowerCase()));
    const tienePerkUpDoble = rarezasPerkUp.has('epic') && rarezasPerkUp.has('legendary');
    let valiosas = recompensas.filter(r => {
        if (!r || !r.tipo) return false;
        const tipo = String(r.tipo || '').toLowerCase();
        const rareza = String(r.rareza || '').toLowerCase();
        if (tipo === 'vbucks') return true;
        if (tipo === 'perkup') return tienePerkUpDoble && ['epic', 'legendary'].includes(rareza);
        if (!['hero', 'survivor', 'defender', 'schematic'].includes(tipo)) return false;
        return ['mythic', 'legendary', 'epic', 'rare'].includes(rareza);
    });
    // La misma misión puede llegar desde dos representaciones del scraper
    // (por ejemplo 50 y 100 PaVos). Una misión solo debe mostrar una cantidad:
    // conservamos la mayor para no anunciar la recompensa como si se sumara.
    const recompensasPavos = valiosas.filter(r => String(r.tipo || '').toLowerCase() === 'vbucks');
    if (recompensasPavos.length > 1) {
        const mayor = recompensasPavos.reduce((a, b) =>
            Number(b.cantidad || b.cantidadVbucks || 0) > Number(a.cantidad || a.cantidadVbucks || 0) ? b : a
        );
        valiosas = valiosas.filter(r => String(r.tipo || '').toLowerCase() !== 'vbucks');
        valiosas.unshift(mayor);
    }
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
    const fuente = String(item && (item.mision || item.misionOriginal) || '').trim();
    if (!fuente || typeof traducirNombre !== 'function') return 'Misión de alerta';

    const partes = fuente.split(/\s+-\s+/);
    let nombreOriginal = partes.shift().trim();
    // Algunos extractores entregan esta misión con una traducción literal que
    // no coincide con el nombre que aparece en el mapa del juego.
    const tormentaCategoria = nombreOriginal.match(/^(?:category\s+([1-4])\s+fight the storm|fight category\s+([1-4])\s+storm|lucha contra (?:una )?tormenta de categoría\s+([1-4]))$/i);
    if (tormentaCategoria) {
        const nivel = tormentaCategoria[1] || tormentaCategoria[2] || tormentaCategoria[3];
        return 'Defiende el Atlas: tormenta de categoría ' + nivel;
    }

    let nombre = traducirNombre(nombreOriginal) || 'Misión de alerta';
    // Si la fuente ya trae una traducción válida, conservarla en vez de degradarla.
    if (/^(recupera los datos|repara el refugio|monta el rayo|evacúa el refugio|entrega la bomba|rescata a los supervivientes|reabastecimiento|elimina y recoge|destruye los campamentos|defiende el atlas)/i.test(nombreOriginal)) {
        nombre = nombreOriginal;
    }
    return nombre;
}

function traducirBiomaAlertaSTW(item) {
    const traductores = traductoresSTW();
    const traducirBioma = traductores.traducirBiomaSTW;
    const fuente = String(item && item.ubicacion || '').trim();
    if (!fuente) return '';
    const bioma = typeof traducirBioma === 'function' ? traducirBioma(fuente) : fuente;
    const limpio = String(bioma || '').replace(/^the\s+/i, '').replace(/\bthe\s+/gi, '').trim();
    return !limpio || /^zona de misión$/i.test(limpio) ? fuente : limpio;
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

function formatearAlertaSTW(item, encabezado = '', mostrarDetalles = false, mostrarTodasRecompensas = false) {
    let texto = '';
    if (encabezado) texto += encabezado + '\n';
    texto += '⚡ *PL:* ' + (item.pl ?? '?') + '\n';
    if (item.zona) texto += '🌍 *Zona:* ' + traducirZonaSalidaSTW(item.zona) + '\n';
    const mision = traducirMisionSalidaSTW(item);
    if (mision) texto += '🎯 *Misión:* ' + mision + '\n';
    const recompensas = mostrarTodasRecompensas
        ? [...new Set((Array.isArray(item.recompensas) ? item.recompensas : []).map(r => typeof r === 'string' ? r : normalizarRecompensaSalidaSTW(r)).filter(Boolean))]
        : obtenerRecompensasValiosasSTW(item);
    if (mostrarTodasRecompensas && !recompensas.length && item.recompensa) recompensas.push(String(item.recompensa));
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


// El scraper puede devolver la misma misión con nombres ligeramente distintos.
// Si coinciden zona y PL y el nombre normalizado es equivalente, conservamos
// la descripción más completa para que la recompensa solo cuente una vez.
function deduplicarAlertasPavos(lista) {
    const normalizarTexto = valor => String(valor || '')
        .split(/\s+-\s+/)[0]
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\b(?:category|categoria)\s*\d+\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(?:a|an|the|la|el|las|los|una|uno|un|de|del)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
    const normalizarMision = item => {
        const nombre = normalizarTexto(item.misionOriginal || item.mision || traducirMisionSalidaSTW(item));
        if (/\blucha\b/.test(nombre) && /\btormenta\b/.test(nombre)) return 'lucha contra tormenta';
        if (/\bfight\b/.test(nombre) && /\bstorm\b/.test(nombre)) return 'fight storm';
        return nombre;
    };
    const normalizarZona = item => normalizarTexto(traducirZonaSalidaSTW(item.zona || 'Desconocida'));
    const mapa = new Map();
    for (const item of (Array.isArray(lista) ? lista : [])) {
        const clave = [normalizarZona(item), String(item.pl ?? '').trim(), normalizarMision(item)].join('|');
        const anterior = mapa.get(clave);
        if (!anterior) {
            mapa.set(clave, item);
            continue;
        }
        const cantidadActual = Number(item.cantidad || item.cantidadVbucks || 0);
        const cantidadAnterior = Number(anterior.cantidad || anterior.cantidadVbucks || 0);
        const calidad = x => String(x.misionOriginal || x.mision || '').length;
        if (cantidadActual > cantidadAnterior ||
            (cantidadActual === cantidadAnterior && calidad(item) > calidad(anterior))) mapa.set(clave, item);
    }
    return Array.from(mapa.values());
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
        datos = { pavos: [], epicas: [], legendarias: [], plAltas: [], materiales: [], errorActualizacion: true };
    }

    const fechaHoy = obtenerFechaActual();
    const lineas = ['📅 _' + fechaHoy + '_', ''];
    if (categoria === 'pavos' || categoria === 'todas') {
        lineas.push('🎮 *ALERTAS DE PAVOS*', '');
        if (!datos.pavos.length) {
            lineas.push(datos.errorActualizacion
                ? '⚠️ _No pude obtener alertas en vivo y todavía no hay caché guardado._'
                : '💔 No hay alertas de PaVos hoy. 😔', '');
        } else {
            let totalPavos = 0;
            const pavosUnicos = deduplicarAlertasPavos(datos.pavos);
            for (const p of pavosUnicos) {
                const cantidad = Number(p.cantidad || p.cantidadVbucks || 50);
                totalPavos += cantidad;
                lineas.push(
                    '🌍 *Zona:* ' + traducirZonaSalidaSTW(p.zona || 'Desconocida'),
                    '⚡ *PL:* ' + (p.pl ?? '?'),
                    '🗺️ *Bioma:* ' + (traducirBiomaAlertaSTW(p) || 'No especificado'),
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

        const materiales = datos.materiales || [];
        lineas.push('🌧️ *MATERIALES DE EVOLUCIÓN* · ' + materiales.length, '');
        if (!materiales.length) {
            lineas.push('_No se detectaron misiones de materiales de evolución en la última consulta._', '');
        } else {
            for (const item of materiales.slice(0, 12)) lineas.push(formatearAlertaSTW(item));
            if (materiales.length > 12) lineas.push('_Hay ' + (materiales.length - 12) + ' misiones más; búscalas con *alertanov* y el nombre del material._', '');
        }
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

async function comandoSubirPL(sock, chatId, msg, args = [], progreso = null) {
    const argumentos = Array.isArray(args) ? args : String(args || '').split(/\s+/).filter(Boolean);
    const plArgumento = argumentos.map(x => String(x).match(/^\d{1,3}$/)).find(Boolean);
    const plObjetivo = plArgumento ? Number(plArgumento[0]) : 62;
    const modoOro = argumentos.some(x => /^(oro|gold)$/i.test(String(x)));
    if (!Number.isInteger(plObjetivo) || plObjetivo < 1 || plObjetivo > 200) {
        await sock.sendMessage(chatId, { text: '❌ Indica un PL válido. Ejemplo: *subirpl 62*.' }, { quoted: msg });
        return;
    }

    if (typeof progreso === 'function') {
        try { await progreso('⏳ Preparando recomendaciones para subir PL.'); } catch (_) {}
    }

    let datos;
    try {
        datos = await obtenerAlertasSTW(false, null, { exhaustivo: true });
    } catch (error) {
        console.error('Error preparando subirpl:', error.stack || error.message);
        datos = null;
    }
    if (!datos) {
        await sock.sendMessage(chatId, { text: '⚠️ No pude leer las alertas guardadas. Inténtalo de nuevo en un momento.' }, { quoted: msg });
        return;
    }

    const fuentes = datos.fuentes || {};
    const todas = [
        ...(datos.pavos || []),
        ...(datos.epicas || []),
        ...(datos.legendarias || []),
        ...(datos.plAltas || []),
        ...(datos.materiales || []),
        ...(Array.isArray(fuentes.principal) ? fuentes.principal : []),
        ...(Array.isArray(fuentes.secundaria) ? fuentes.secundaria : []),
        ...(Array.isArray(fuentes.tercera) ? fuentes.tercera : [])
    ];
    const normalizar = valor => String(valor || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const infoRecompensas = item => (Array.isArray(item.recompensas) ? item.recompensas : [])
        .map(r => typeof r === 'string' ? r : [r.nombre, r.raw, r.tipo, r.rareza, r.cantidad].filter(x => x !== undefined && x !== null).join(' '))
        .concat([item.recompensa, item.tipoAlertaTexto].filter(Boolean)).join(' | ');
    const regexXP = /people.?\s*xp|experiencia.{0,20}personas|survivor.?s?\s*xp|survivor experience|experiencia.{0,20}(?:superviviente|sobreviviente)|(?:superviviente|sobreviviente).{0,20}(?:experiencia|exp\b)|hero.?s?\s*xp/i;
    const regexMateriales = /pure drop of rain|drop of rain|gotas?.{0,20}lluvia|lightning in a bottle|relampago.{0,20}botella|eye of the storm|ojo.{0,15}tormenta|storm shard|fragmento.{0,15}tormenta|evolution material|material de evolucion/i;
    const regexSuperviviente = /\bsurvivor\b|superviviente|sobreviviente|lead survivor|survivor squad/i;
    const regexOro = /(?:^|[^a-z])(?:gold|oro)(?:$|[^a-z])/i;
    const prioridad = texto => regexXP.test(texto) ? 0 : regexMateriales.test(texto) ? 1 :
        regexSuperviviente.test(texto) ? 2 : regexOro.test(texto) ? 3 : 4;
    const porMision = new Map();
    for (const item of todas) {
        if (!item || typeof item !== 'object') continue;
        const pl = Number(String(item.pl ?? '').replace(/[^0-9]/g, ''));
        if (Number.isFinite(pl) && pl > plObjetivo + 10) continue;
        const texto = infoRecompensas(item);
        const textoNorm = normalizar(texto);
        const esOro = regexOro.test(textoNorm);
        if (modoOro ? !esOro : !(regexXP.test(textoNorm) || regexMateriales.test(textoNorm) || regexSuperviviente.test(textoNorm) || esOro)) continue;
        const mision = normalizar(item.misionOriginal || item.mision || item.nombre);
        const clave = [pl, normalizar(item.zona || item.ubicacion), mision].join('|');
        const anterior = porMision.get(clave);
        if (!anterior || infoRecompensas(item).length > infoRecompensas(anterior).length) porMision.set(clave, item);
    }

    const lista = [...porMision.values()].sort((a, b) => {
        const pa = prioridad(infoRecompensas(a));
        const pb = prioridad(infoRecompensas(b));
        if (pa !== pb) return pa - pb;
        return Number(a.pl || 0) - Number(b.pl || 0);
    });
    const fecha = obtenerFechaActual();
    const lineas = ['📅 _' + fecha + '_', '', modoOro
        ? '🪙 *FARMEAR ORO — SALVAR EL MUNDO*'
        : '🚀 *PLAN DIARIO PARA SUBIR PL*', '',
    '🎯 *PL de referencia:* ' + plObjetivo,
    '📌 _Recomendaciones basadas en las alertas guardadas que el bot tiene disponibles; no se muestran cantidades que la fuente no haya proporcionado._', ''];

    if (!lista.length) {
        lineas.push(modoOro
            ? '_No encontré alertas guardadas identificadas claramente como oro. Revisa las recompensas actuales del mapa._'
            : '_No encontré alertas guardadas con experiencia de superviviente, materiales de evolución, supervivientes u oro. Puede que el caché no contenga esas recompensas._',
        '', '💡 *Consejo:* sube primero los supervivientes de tus escuadrones, asigna líderes correctos y gasta la experiencia/materiales solo en mejoras que aumenten tu potencia.');
    } else {
        const limite = 12;
        for (const item of lista.slice(0, limite)) {
            const textoRecompensa = infoRecompensas(item);
            const etiqueta = regexXP.test(textoRecompensa) ? '🧬 *Prioridad: EXP de superviviente*'
                : regexMateriales.test(textoRecompensa) ? '🌧️ *Prioridad: materiales de evolución*'
                : regexSuperviviente.test(textoRecompensa) ? '🧑‍🚀 *Prioridad: supervivientes*'
                : '🪙 *Oro*';
            lineas.push(etiqueta);
            lineas.push(formatearAlertaSTW(item, '', false, true).trim(), '');
        }
        if (lista.length > limite) lineas.push('_Hay ' + (lista.length - limite) + ' misiones más que coinciden; usa *alertanov* con el nombre del material para buscarlas._', '');
        if (!modoOro) lineas.push('🛠️ *Orden recomendado:* EXP de superviviente → materiales que te falten → supervivientes/líderes → oro.', '');
    }
    lineas.push('Apoya a un creador: *JASC13* ❤️');
    await sock.sendMessage(chatId, { text: lineas.join('\n') }, { quoted: msg });
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

async function comandoPreguntarAlerta(sock, chatId, msg, palabrasClave = [], progreso = null, mostrarDetalles = false, modoRecompensa = false) {
    let progresoEnviado = false;
    const informar = async () => {
        if (typeof progreso !== 'function' || progresoEnviado) return;
        progresoEnviado = true;
        try { await progreso('⏳ Buscando alertas.'); } catch (_) {}
    };
    const nombreComando = modoRecompensa ? (mostrarDetalles ? 'recompensanov' : 'recompensa') : (mostrarDetalles ? 'alertanov' : 'alerta');
    const termino = Array.isArray(palabrasClave)
        ? palabrasClave.join(' ').trim()
        : String(palabrasClave || '').trim();

    if (!termino) {
        await sock.sendMessage(chatId, { text: '🤖 Escribe una recompensa o combina tipo y rareza. Ejemplos: *recompensa defensor legendario*, *recompensa héroe épico*, *recompensanov superviviente legendario*.' }, { quoted: msg });
        return;
    }

    await informar('🔎 Iniciando búsqueda de alertas.');
    const datos = await obtenerAlertasSTW(false, informar, mostrarDetalles ? { exhaustivo: true } : {});
    await informar('🔎 Datos de alertas cargados; buscando coincidencias.');
    const hayDatosDisponibles = datos.pavos.length + datos.epicas.length + datos.legendarias.length + (datos.plAltas || []).length + (datos.materiales || []).length > 0;
    if (datos.errorActualizacion && !hayDatosDisponibles) {
        await sock.sendMessage(chatId, { text: '⚠️ No pude actualizar las alertas y no hay datos guardados para buscar. Inténtalo de nuevo en un momento.' }, { quoted: msg });
        return;
    }
    const normalizarTexto = texto => String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const normalizarBusquedaRecompensa = valor => normalizarTexto(valor)
        .replace(/gotas?\s+(?:puras?\s+de\s+lluvia|de\s+lluvia(?:\s+pura)?)|pure\s*drop\s*of\s*rain|drop\s*of\s*rain/g, ' pure drop of rain ')
        .replace(/relampago\s+en\s+(?:una\s+)?botella|lightning\s+in\s+a\s+bottle/g, ' lightning in a bottle ')
        .replace(/ojo\s+de\s+(?:la\s+)?tormenta|eye\s+of\s+(?:the\s+)?storm/g, ' eye of the storm ')
        .replace(/fragmento\s+de\s+tormenta|storm\s+shard/g, ' storm shard ')
        .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const distanciaEdicion = (a, b) => {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > 1) return 2;
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const curr = [i];
            for (let j = 1; j <= b.length; j++) curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = curr;
        }
        return prev[b.length];
    };
    const coincideRecompensaTolerante = (consulta, textoRecompensas) => {
        const q = normalizarBusquedaRecompensa(consulta).split(' ').filter(p => p.length > 1);
        const tokens = normalizarBusquedaRecompensa(textoRecompensas).split(' ').filter(p => p.length > 1);
        if (!q.length || !tokens.length) return false;
        const aciertos = q.filter(p => tokens.some(t => t.includes(p) || p.includes(t) || (Math.min(p.length, t.length) >= 4 && distanciaEdicion(p, t) <= 1))).length;
        const requeridos = q.length <= 2 ? q.length : Math.max(2, Math.ceil(q.length * 0.65));
        return aciertos >= requeridos;
    };

    const partesBusqueda = termino.split(/\s+/).filter(Boolean);
    const tokensConsulta = normalizarTexto(termino).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
    const filtrosTipo = {
        heroe: ['hero', 'heroe', 'heroes'],
        defensor: ['defender', 'defensor', 'defensores'],
        superviviente: ['survivor', 'superviviente', 'supervivientes'],
        esquema: ['schematic', 'esquema', 'esquemas'],
        perkup: ['perkup', 'perk', 'up']
    };
    const filtrosRareza = {
        legendary: ['legendario', 'legendaria', 'legendarios', 'legendarias', 'legendary'],
        epic: ['epico', 'epica', 'epicos', 'epicas', 'epic'],
        mythic: ['mitico', 'mitica', 'miticos', 'miticas', 'mythic'],
        rare: ['raro', 'rara', 'raros', 'raras', 'rare']
    };
    const tipoBuscado = Object.keys(filtrosTipo).find(k => filtrosTipo[k].some(alias => tokensConsulta.includes(alias))) || '';
    const rarezaBuscada = Object.keys(filtrosRareza).find(k => filtrosRareza[k].some(alias => tokensConsulta.includes(alias))) || '';
    const palabrasFiltro = new Set([...Object.values(filtrosTipo).flat(), ...Object.values(filtrosRareza).flat()]);
    const terminoRestante = tokensConsulta.filter(t => !palabrasFiltro.has(t)).join(' ').trim();
    const hayFiltroTipoRareza = Boolean(tipoBuscado || rarezaBuscada);
    const coincideFiltroRecompensa = r => {
        if (!r || typeof r === 'string') return false;
        const tipo = normalizarTexto(r.tipo || '').replace(/[^a-z0-9]+/g, '');
        const rareza = normalizarTexto(r.rareza || '').replace(/[^a-z0-9]+/g, '');
        const tiposCanonicos = {
            heroe: ['hero', 'heroes', 'heroe'],
            defensor: ['defender', 'defensor'],
            superviviente: ['survivor', 'superviviente'],
            esquema: ['schematic', 'esquema'],
            perkup: ['perkup']
        };
        if (tipoBuscado && !(tiposCanonicos[tipoBuscado] || [tipoBuscado]).some(t => tipo === t || tipo.includes(t))) return false;
        if (rarezaBuscada && !(rareza === rarezaBuscada || rareza.includes(rarezaBuscada))) return false;
        return true;
    };
    const terminoBusquedaLibre = terminoRestante || (hayFiltroTipoRareza ? '' : termino);
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

    // Buscar también en las tres fuentes originales: los materiales pueden venir
    // dentro de recompensas normales y no aparecer en las listas filtradas/caché.
    const fuentesOriginales = datos.fuentes || {};

    // Una cantidad solo es confiable si coincide exactamente en dos fuentes independientes.
    const canonMaterial = valor => {
        const s = normalizarTexto(valor).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (/pure drop of rain|drop of rain|gotas? pura? de lluvia/.test(s)) return 'Gota pura de lluvia';
        if (/lightning in a bottle|relampago en una botella/.test(s)) return 'Relámpago en una botella';
        if (/eye of the storm|ojo de la tormenta/.test(s)) return 'Ojo de la tormenta';
        if (/storm shard|fragmento de tormenta/.test(s)) return 'Fragmento de tormenta';
        if (/hero xp|xp de heroe|experiencia de heroe/.test(s)) return 'XP de héroe';
        if (/survivor xp|xp de superviviente|experiencia de superviviente/.test(s)) return 'XP de superviviente';
        if (/schematic xp|xp de esquema|experiencia de esquema/.test(s)) return 'XP de esquema';
        if (/defender xp|xp de defensor|experiencia de defensor/.test(s)) return 'XP de defensor';
        return '';
    };
    const normalizarMisionCantidad = item => [
        normalizarTexto(item.zona || '').replace(/[^a-z0-9]+/g, ' ').trim(),
        String(item.pl ?? ''),
        normalizarTexto(item.misionOriginal || item.mision || '').split(/\s+-\s+/)[0].replace(/[^a-z0-9]+/g, ' ').trim()
    ].join('|');
    const observacionesCantidad = new Map();
    const fuentesNombres = { principal: 'STW Planner', secundaria: 'V-Bucks Daily', tercera: 'SeeBot.dev' };
    for (const [claveFuente, listaFuente] of Object.entries(fuentesOriginales)) {
        if (!Array.isArray(listaFuente)) continue;
        for (const item of listaFuente) {
            const misionKey = normalizarMisionCantidad(item);
            for (const r of (Array.isArray(item.recompensas) ? item.recompensas : [])) {
                if (!r || typeof r === 'string') continue;
                const material = canonMaterial([r.raw, r.nombre, r.tipo, r.iconClasses].filter(Boolean).join(' '));
                const cantidad = Number(r.cantidad);
                if (!material || !Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 100000) continue;
                const key = misionKey + '|' + material;
                if (!observacionesCantidad.has(key)) observacionesCantidad.set(key, { material, misionKey, cantidades: new Map() });
                const registro = observacionesCantidad.get(key);
                if (!registro.cantidades.has(cantidad)) registro.cantidades.set(cantidad, new Set());
                registro.cantidades.get(cantidad).add(fuentesNombres[claveFuente] || claveFuente);
            }
        }
    }
    const cantidadesVerificadas = [];
    for (const registro of observacionesCantidad.values()) {
        const validas = [...registro.cantidades.entries()].filter(([, fuentes]) => fuentes.size >= 2);
        if (validas.length !== 1) continue;
        const [cantidad, fuentes] = validas[0];
        cantidadesVerificadas.push({ material: registro.material, misionKey: registro.misionKey, cantidad, fuentes: [...fuentes] });
    }
    const totalesMaterialVerificados = new Map();
    for (const registro of cantidadesVerificadas) {
        const actual = totalesMaterialVerificados.get(registro.material) || { total: 0, misiones: 0 };
        actual.total += registro.cantidad;
        actual.misiones += 1;
        totalesMaterialVerificados.set(registro.material, actual);
    }

    // En búsquedas por PL solo mostramos misiones que tengan recompensas
    // realmente útiles: rarezas altas o materiales de evolución importantes.
    const recompensasValiosasParaPL = item => {
        const lista = Array.isArray(item.recompensas) ? item.recompensas : [];
        const materialesValiosos = /(?:eye\s+of\s+(?:the\s+)?storm|ojo\s+de\s+(?:la\s+)?tormenta|pure\s+drop\s+of\s+rain|drop\s+of\s+rain|gotas?\s+(?:puras?\s+de\s+lluvia|de\s+lluvia)|lightning\s+in\s+a\s+bottle|rel[aá]mpago\s+en\s+(?:una\s+)?botella|storm\s+shard|fragmento\s+de\s+tormenta|epic\s+perk.?up|legendary\s+perk.?up|perk.?up\s+(?:epic|legendary)|reperks?|repercutores?)/i;
        const valiosas = lista.filter(r => {
            if (typeof r === 'string') return materialesValiosos.test(r);
            if (!r) return false;
            const tipo = normalizarTexto(r.tipo || '').replace(/[^a-z0-9]+/g, '');
            const rareza = normalizarTexto(r.rareza || '').replace(/[^a-z0-9]+/g, '');
            const texto = [r.nombre, r.raw, r.tipo, r.iconClasses].filter(Boolean).join(' ');
            if (materialesValiosos.test(texto)) return true;
            if (tipo === 'vbucks') return true;
            if (tipo === 'perkup') return ['epic', 'legendary'].includes(rareza);
            if (['hero', 'survivor', 'defender', 'schematic'].includes(tipo)) {
                return ['epic', 'legendary', 'mythic'].includes(rareza);
            }
            return false;
        });
        const textoPlano = [item.recompensa, item.tipoAlertaTexto].filter(Boolean).join(' ');
        if (!valiosas.length && materialesValiosos.test(textoPlano)) {
            return [{ tipo: 'material', nombre: textoPlano, raw: textoPlano }];
        }
        return valiosas;
    };

    const coincidenciasFiltradas = [
        ...datos.pavos.map(item => ({ ...item, categoria: 'PaVos' })),
        ...datos.epicas.map(item => ({ ...item, categoria: 'Épicas' })),
        ...datos.legendarias.map(item => ({ ...item, categoria: 'Legendarias' })),
        ...(datos.plAltas || []).map(item => ({ ...item, categoria: 'Destacadas' })),
        ...(datos.materiales || []).map(item => ({ ...item, categoria: 'Materiales de evolución' })),
        ...(Array.isArray(fuentesOriginales.principal) ? fuentesOriginales.principal : []).map(item => ({ ...item, categoria: 'Alertas' })),
        ...(Array.isArray(fuentesOriginales.secundaria) ? fuentesOriginales.secundaria : []).map(item => ({ ...item, categoria: 'Alertas' })),
        ...(Array.isArray(fuentesOriginales.tercera) ? fuentesOriginales.tercera : []).map(item => ({ ...item, categoria: 'Alertas' }))
    ].filter(item => {
        if (esBusquedaPL) {
            const plItem = Number(String(item.pl || '').replace(/[^0-9]/g, ''));
            if (!(plItem >= Math.min(plMinimo, plMaximo) && plItem <= Math.max(plMinimo, plMaximo))) return false;
            const recompensasFiltradas = recompensasValiosasParaPL(item);
            if (!recompensasFiltradas.length) return false;
            item._recompensasFiltradas = recompensasFiltradas;
            return true;
        }
        const listaRecompensas = Array.isArray(item.recompensas) ? item.recompensas : [];
        if (modoRecompensa) {
            const textoRecompensas = [item.recompensa, ...listaRecompensas.map(r => typeof r === 'string' ? r : [r.nombre, r.raw, r.tipo, r.rareza, r.iconClasses].filter(Boolean).join(' '))].filter(Boolean).join(' ');
            if (hayFiltroTipoRareza) {
                const recompensasCoincidentes = listaRecompensas.filter(coincideFiltroRecompensa);
                if (!recompensasCoincidentes.length) return false;
                item._recompensasFiltradas = recompensasCoincidentes;
                return !terminoRestante || coincideRecompensaTolerante(terminoRestante, textoRecompensas);
            }
            return coincideRecompensaTolerante(terminoBusquedaLibre, textoRecompensas);
        }
        const textoBusqueda = normalizarTexto([
            item.mision, item.misionOriginal, item.zona, item.nombre, item.recompensa,
            ...listaRecompensas.map(r => typeof r === 'string' ? r : [r.nombre, r.raw, r.tipo, r.iconClasses].filter(Boolean).join(' ')),
            item.cantidad, item.cantidadVbucks, item.tipoAlertaTexto
        ].filter(Boolean).join(' '));
        return textoBusqueda.includes(clave);
    });

    const coincidenciasUnicas = [];
    const normalizarClave = valor => normalizarTexto(valor).replace(/\s+/g, ' ').trim();
    const normalizarMisionBusqueda = item => {
        // El sufijo tras " - " suele ser bioma/modificador, no otra misión.
        let nombre = normalizarClave(traducirMisionSalidaSTW(item)).split(/\s+-\s+/)[0];
        nombre = nombre
            .replace(/\b(?:category|categoria)\s*\d+\b/g, ' ')
            .replace(/\b(?:a|an|the|la|el|las|los|una|uno|un|de|del)\b/g, ' ')
            .replace(/\s+/g, ' ').trim();
        if (/\blucha\b/.test(nombre) && /\btormenta\b/.test(nombre)) return 'lucha contra tormenta';
        if (/\bfight\b/.test(nombre) && /\bstorm\b/.test(nombre)) return 'fight storm';
        return nombre;
    };
    const normalizarZonaBusqueda = zona => normalizarClave(zona).replace(/[^a-z0-9]+/g, ' ').trim();
    const zonaEsDesconocida = zona => !String(zona || '').trim() ||
        /^(desconocida|zona desconocida|unknown|n\/?a)$/i.test(String(zona || '').trim());

    for (const item of coincidenciasFiltradas) {
        const zona = normalizarZonaBusqueda(item.zona);
        const mision = normalizarMisionBusqueda(item);
        const pl = Number(item.pl || 0);
        const indice = coincidenciasUnicas.findIndex(prev =>
            Number(prev.pl || 0) === pl &&
            normalizarMisionBusqueda(prev) === mision &&
            (normalizarZonaBusqueda(prev.zona) === zona ||
                zonaEsDesconocida(prev.zona) || zonaEsDesconocida(item.zona))
        );
        if (indice < 0) {
            coincidenciasUnicas.push({
                ...item,
                categoria: [item.categoria],
                recompensas: [...(item.recompensas || [])],
                modificadores: [...(item.modificadores || [])]
            });
            continue;
        }

        const anterior = coincidenciasUnicas[indice];
        const categorias = [...new Set([
            ...(Array.isArray(anterior.categoria) ? anterior.categoria : [anterior.categoria]),
            item.categoria
        ])];
        const anteriorZonaMala = zonaEsDesconocida(anterior.zona);
        const itemZonaMala = zonaEsDesconocida(item.zona);
        const anteriorDestacada = (Array.isArray(anterior.categoria) ? anterior.categoria : [anterior.categoria]).includes('Destacadas');
        const itemDestacada = item.categoria === 'Destacadas';
        // Conservar zona real y, si empatan, la alerta destacada que trae el premio mayor.
        const conservarItem = (anteriorZonaMala && !itemZonaMala) ||
            (anteriorZonaMala === itemZonaMala &&
                ((!anteriorDestacada && itemDestacada) ||
                 (anteriorDestacada === itemDestacada &&
                  Number(item.cantidad || item.cantidadVbucks || 0) > Number(anterior.cantidad || anterior.cantidadVbucks || 0))));
        const elegido = conservarItem ? item : anterior;
        const otro = conservarItem ? anterior : item;
        coincidenciasUnicas[indice] = {
            ...otro, ...elegido,
            categoria: categorias,
            // No sumar recompensas de dos representaciones de la misma misión.
            recompensas: [...(elegido.recompensas || [])],
            modificadores: [...new Set([...(elegido.modificadores || []), ...(otro.modificadores || [])])],
            questReqs: elegido.questReqs || otro.questReqs,
            requisitos: elegido.requisitos || otro.requisitos
        };
    }
    const coincidencias = coincidenciasUnicas;
    const etiquetaPL = plMinimo === plMaximo
        ? String(plMinimo)
        : Math.min(plMinimo, plMaximo) + '-' + Math.max(plMinimo, plMaximo);

    let texto = esBusquedaPL
        ? '🔎 *ALERTAS CON PL ' + etiquetaPL + '*\n\n'
        : '🔎 *ALERTAS QUE CONTIENEN:* ' + termino + '\n\n';
    if (modoRecompensa && !hayFiltroTipoRareza) {
        const resumen = [...totalesMaterialVerificados.entries()]
            .filter(([material]) => coincideRecompensaTolerante(terminoBusquedaLibre, material))
            .sort((a, b) => a[0].localeCompare(b[0]));
        if (resumen.length) {
            texto += '📊 *TOTALES VERIFICADOS EN 2 O MÁS PÁGINAS*\n';
            for (const [material, dato] of resumen) {
                texto += '• *' + material + ':* ' + dato.total + ' en ' + dato.misiones + ' misiones\n';
            }
            texto += '_Solo sumo cantidades iguales confirmadas por dos fuentes; si discrepan o no se verifican, no las cuento._\n\n';
        } else {
            texto += '📊 _No hay cantidades de este material confirmadas por dos páginas con la misma cifra. No mostraré un total estimado._\n\n';
        }
    }

    await informar('🔎 Búsqueda terminada; coincidencias=' + coincidencias.length + '.');
    if (coincidencias.length === 0) {
        texto += esBusquedaPL
            ? '_No encontré alertas con PL ' + etiquetaPL + '._\n\n'
            : '_No encontré alertas que contengan esa palabra o frase._\n\n';
    } else {
        coincidencias.forEach(item => {
            const categorias = Array.isArray(item.categoria) ? item.categoria : [item.categoria];
            texto += '📌 *' + [...new Set(categorias)].join(' / ') + '*\n';
            const itemParaMostrar = (esBusquedaPL || (modoRecompensa && Array.isArray(item._recompensasFiltradas)))
                ? {
                    ...item,
                    recompensas: Array.isArray(item._recompensasFiltradas) ? item._recompensasFiltradas : item.recompensas,
                    // En búsqueda por PL, evita que el fallback muestre una lista cruda con premios comunes.
                    ...(esBusquedaPL ? { recompensa: '' } : {})
                }
                : item;
            texto += formatearAlertaSTW(itemParaMostrar, '', mostrarDetalles, modoRecompensa || esBusquedaPL);
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
        // Se aplica la misma deduplicación que al comando pavos: zona + PL y
        // nombres de misión casi equivalentes; se conserva el nombre más completo.
        const alertas = deduplicarAlertasPavos(
            pavos.filter(x => Number(x.cantidad || x.cantidadVbucks || 0) > 0)
        );
        if (!alertas.length) {
            if (!avisarSinPavos) return false;
            let avisoEnviado = false;
            for (const grupo of grupos) {
                try {
                    const mensajeVacio = await sock.sendMessage(grupo, { text: '🎮 *ALERTAS DE PAVOS AUTOMÁTICA*\n\n💔 No hay alertas de PaVos hoy. 😔\n\nSupport-a-Creator: *JASC13* ❤️' });
                    await fijarAlertaPavosEnGrupo(sock, grupo, mensajeVacio?.key, fechaCDMX());
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
                '🗺️ *Bioma:* ' + (traducirBiomaAlertaSTW(item) || 'No especificado') + '\n' +
                '🎯 *Misión:* ' + traducirMisionSalidaSTW(item) + '\n' +
                '🪙 *PaVos:* ' + cantidad + '\n\n';
        }
        mensaje += '💰 *Total del día:* ' + total + ' PaVos\n\n🔎 Usa *pavos* para consultar la información guardada.';
        const hoy = fechaCDMX();
        const estadoDoc = await Config.findOne({ clave: CLAVE_ESTADO_ALERTA_PAVOS });
        let gruposEnviados = new Set();
        try {
            const estado = estadoDoc?.valor ? JSON.parse(estadoDoc.valor) : null;
            if (estado?.fecha === hoy && Array.isArray(estado.gruposEnviados)) {
                gruposEnviados = new Set(estado.gruposEnviados.filter(id => grupos.includes(id)));
            }
        } catch (_) {}
        const pendientes = grupos.filter(grupo => !gruposEnviados.has(grupo));
        if (!pendientes.length) return true;
        const firmas = {};
        for (const item of alertas) firmas[claveMisionAlertaDiaria(item)] = firmaMisionAlertaDiaria(item);
        for (const grupo of pendientes) {
            try {
                const socketEnvio = socketAlertasDiariasActivo || sock;
                const mensajeEnviado = await socketEnvio.sendMessage(grupo, { text: mensaje });

                // Solo se fija el mensaje principal de las 6:01:20 PM y sus recuperaciones.
                // WhatsApp exige indicar time: 86400 para limitar la fijación a 24 horas.
                const esAlertaPrincipal = ['6:01:20 PM', 'reintento automático', 'recuperación tras reconexión'].includes(horaAlerta);
                if (esAlertaPrincipal && mensajeEnviado?.key) {
                    await fijarAlertaPavosEnGrupo(socketEnvio, grupo, mensajeEnviado.key, hoy);
                }

                gruposEnviados.add(grupo);
                await guardarAlertaPavosEnviada(hoy, horaAlerta, { snapshot: firmas }, [...gruposEnviados], grupos.length);
                console.log('✅ Alerta diaria de PaVos aceptada por WhatsApp para el grupo ' + grupo + '.');
            } catch (e) {
                console.error('Error enviando alerta diaria al grupo ' + grupo + ':', e.message);
            }
        }
        return grupos.every(grupo => gruposEnviados.has(grupo));
    } catch (error) {
        console.error('Error en alerta diaria:', error.stack || error.message);
        return false;
    }
}

const CLAVE_REGISTRO_PIN_PAVOS = 'stw_pavos_alerta_pin_registry';
const socketsConVigilanciaPins = new WeakSet();

async function leerRegistroPinsPavos() {
    try {
        const doc = await Config.findOne({ clave: CLAVE_REGISTRO_PIN_PAVOS });
        const parsed = doc?.valor ? JSON.parse(doc.valor) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('⚠️ No se pudo leer el registro de fijados de PaVos:', error.message);
        return [];
    }
}

async function guardarRegistroPinsPavos(registros) {
    await Config.findOneAndUpdate(
        { clave: CLAVE_REGISTRO_PIN_PAVOS },
        { valor: JSON.stringify(registros) },
        { upsert: true }
    );
}

async function fijarAlertaPavosEnGrupo(sock, grupo, key, fecha = fechaCDMX(), forzar = false) {
    if (!sock || !grupo || !key?.id) return false;
    const registros = await leerRegistroPinsPavos();
    const indice = registros.findIndex(r => r.grupo === grupo);
    const previo = indice >= 0 ? registros[indice] : null;
    const ahora = Date.now();

    if (!forzar && previo?.key?.id === key.id && previo.ultimaFijacion &&
        ahora - new Date(previo.ultimaFijacion).getTime() < 23 * 60 * 60 * 1000) {
        return true;
    }

    try {
        await sock.sendMessage(grupo, { pin: { key, type: 1, time: 86400 } });
        const registro = { grupo, key, fecha, ultimaFijacion: new Date().toISOString(), pendiente: false };
        if (indice >= 0) registros[indice] = registro;
        else registros.push(registro);
        await guardarRegistroPinsPavos(registros);
        console.log('📌 Alerta de PaVos fijada por 24 horas en ' + grupo + ' (mensaje ' + key.id + ').');
        return true;
    } catch (errorPin) {
        const registro = { grupo, key, fecha, ultimaFijacion: previo?.ultimaFijacion || null, pendiente: true };
        if (indice >= 0) registros[indice] = registro;
        else registros.push(registro);
        try { await guardarRegistroPinsPavos(registros); } catch (_) {}
        console.warn('⚠️ No se pudo fijar la alerta de PaVos en ' + grupo + '; se volverá a intentar: ' + (errorPin.message || errorPin));
        return false;
    }
}

async function revisarPinsAlertaPavos(sock) {
    if (!sock) return;
    const registros = await leerRegistroPinsPavos();
    const ahora = Date.now();
    for (const registro of registros) {
        if (!registro?.grupo || !registro?.key?.id) continue;
        const ultima = registro.ultimaFijacion ? new Date(registro.ultimaFijacion).getTime() : 0;
        if (registro.pendiente || !ultima || ahora - ultima >= 23 * 60 * 60 * 1000) {
            await fijarAlertaPavosEnGrupo(sock, registro.grupo, registro.key, registro.fecha || fechaCDMX(), true);
        }
    }
}

function instalarVigilanciaPinsAlertaPavos(sock) {
    if (!sock?.ev || socketsConVigilanciaPins.has(sock)) return;
    socketsConVigilanciaPins.add(sock);
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const registros = await leerRegistroPinsPavos();
            for (const msg of (messages || [])) {
                const pin = msg?.message?.protocolMessage?.pinInChat;
                if (!pin) continue;
                const clave = pin.key;
                if (!clave?.id) continue;
                const registro = registros.find(r => r.key?.id === clave.id && r.grupo === msg.key?.remoteJid);
                if (registro && Number(pin.type) !== 1) {
                    console.log('🔎 La alerta de PaVos fue des fijada en ' + registro.grupo + '; intentando fijarla otra vez.');
                    await fijarAlertaPavosEnGrupo(socketAlertasDiariasActivo || sock, registro.grupo, registro.key, registro.fecha || fechaCDMX(), true);
                }
            }
        } catch (error) {
            console.warn('⚠️ Error revisando cambios de fijado de alertas de PaVos:', error.message);
        }
    });
}

const CLAVE_ESTADO_ALERTA_PAVOS = 'stw_pavos_alerta_diaria_estado';
let cronAlertasDiariasIniciado = false;
let raspadoEnCurso = false;
let socketAlertasDiariasActivo = null;
let recuperacionAlertaPavosEnCurso = false;

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
        const [doc, configChat] = await Promise.all([
            Config.findOne({ clave: CLAVE_ESTADO_ALERTA_PAVOS }),
            Config.findOne({ clave: 'chat_alertas_diarias' })
        ]);
        if (!doc?.valor || !configChat?.valor) return false;
        const estado = JSON.parse(doc.valor);
        let grupos = [];
        try {
            const parsed = JSON.parse(configChat.valor);
            grupos = Array.isArray(parsed) ? parsed : [configChat.valor];
        } catch (_) {
            grupos = [configChat.valor];
        }
        grupos = [...new Set(grupos.filter(id => typeof id === 'string' && id.endsWith('@g.us')))];
        if (!grupos.length || estado?.fecha !== hoy || estado?.enviada !== true) return false;
        // No aceptar estados antiguos que marcaban todo como enviado con que un solo grupo tuviera éxito.
        return Array.isArray(estado.gruposEnviados) &&
            grupos.every(grupo => estado.gruposEnviados.includes(grupo));
    } catch (e) {
        console.error('⚠️ No se pudo leer el estado diario de PaVos:', e.message);
        return false;
    }
}

async function guardarAlertaPavosEnviada(hoy, horario, firmasPorFuente = {}, gruposEnviados = [], totalGrupos = gruposEnviados.length) {
    const enviados = [...new Set(gruposEnviados)];
    const completa = totalGrupos > 0 && enviados.length >= totalGrupos;
    await Config.findOneAndUpdate(
        { clave: CLAVE_ESTADO_ALERTA_PAVOS },
        { valor: JSON.stringify({ fecha: hoy, enviada: completa, horario, firmasPorFuente, gruposEnviados: enviados, totalGrupos, actualizadoEn: new Date().toISOString() }) },
        { upsert: true }
    );
}

function iniciarCronAlertasDiarias(sock) {
    // El cron vive durante toda la vida del proceso, pero Baileys reemplaza el socket
    // al reconectar. Actualizamos siempre la referencia para no enviar con un socket muerto.
    if (sock) {
        socketAlertasDiariasActivo = sock;
        instalarVigilanciaPinsAlertaPavos(sock);
    }
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
        'stw_materiales_evolucion_scrapeadas',
        'stw_todas_alertas_scrapeadas',
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

    // Raspado de respaldo de todas las recompensas después de las alertas de PaVos.
    // Se ejecuta una vez al día y comparte el bloqueo para no duplicar peticiones.
    cron.schedule('0 10 18 * * *', async () => {
        if (raspadoEnCurso) {
            console.log('⏭️ 6:10 PM: se omite el raspado completo STW porque ya hay otro raspado en curso.');
            return;
        }
        raspadoEnCurso = true;
        try {
            console.log('🌐 6:10 PM: reconstruyendo la caché completa de alertas y recompensas STW.');
            const { extraerAlertasAPI } = require('../webBridge');
            const resultado = await extraerAlertasAPI();
            if (resultado && resultado.ok === true) {
                const todas = await leerConfigJSON('stw_todas_alertas_scrapeadas');
                const materiales = await leerConfigJSON('stw_materiales_evolucion_scrapeadas');
                console.log('✅ 6:10 PM: caché STW reconstruida. Fuentes completas=' + todas.length + ', alertas con materiales=' + materiales.length + '.');
            } else {
                console.warn('⚠️ 6:10 PM: el raspado completo STW no confirmó éxito; se revisarán los logs de las fuentes.');
            }
        } catch (error) {
            console.error('❌ Error en el raspado completo STW de las 6:10 PM:', error.stack || error.message);
        } finally {
            raspadoEnCurso = false;
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
                        await enviarAlertaPavosAutomatica(socketAlertasDiariasActivo || sock, false, horario.etiqueta, true, false);
                    }
                    return;
                }
                const socketEnvio = socketAlertasDiariasActivo || sock;
                const enviada = await enviarAlertaPavosAutomatica(socketEnvio, false, horario.etiqueta, false);
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
    // Revisa fijados pendientes cada 5 minutos y renueva antes de que venza el plazo de 24 h.
    // Baileys no expone una consulta directa de todos los mensajes fijados del grupo; se guarda
    // la clave del mensaje, se escuchan avisos de desfijado y se reintentan fallos.
    cron.schedule('*/5 * * * *', async () => {
        try {
            await revisarPinsAlertaPavos(socketAlertasDiariasActivo || sock);
        } catch (error) {
            console.error('⚠️ Error en la revisión automática de fijados de PaVos:', error.message);
        }
    }, { scheduled: true, timezone: zonaHoraria });

    // Reintento liviano cada 30 segundos después de las 18:01:20 hasta que TODOS los grupos reciban la alerta.
    // Usa la caché ya guardada: no vuelve a raspar la web ni repite mensajes a grupos que ya confirmaron envío.
    cron.schedule('*/30 * * * * *', async () => {
        try {
            const partes = new Intl.DateTimeFormat('en-GB', {
                timeZone: zonaHoraria,
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            }).formatToParts(new Date());
            const hora = Number(partes.find(p => p.type === 'hour')?.value);
            const minuto = Number(partes.find(p => p.type === 'minute')?.value);
            if (hora < 18 || (hora === 18 && minuto < 1)) return;
            if (raspadoEnCurso || !socketAlertasDiariasActivo) return;
            const hoy = fechaCDMX();
            if (await yaSeEnvioAlertaPavosHoy(hoy)) return;
            const pavos = await leerConfigJSON('stw_pavos_scrapeados');
            if (!pavos.some(p => Number(p.cantidad || p.cantidadVbucks || 0) > 0)) return;
            const enviada = await enviarAlertaPavosAutomatica(
                socketAlertasDiariasActivo,
                false,
                'reintento automático',
                false
            );
            if (enviada) console.log('✅ Reintento automático: la alerta diaria quedó enviada a todos los grupos configurados.');
        } catch (error) {
            console.error('⚠️ Error en reintento automático de alerta diaria:', error.message);
        }
    }, { scheduled: true, timezone: zonaHoraria });

    console.log('🕒 STW: borrado de caché 17:59:40; raspado 18:01:20 y reintentos 18:02:00/18:05:00 si faltan PaVos (hora CDMX).');
}

async function reanudarAlertaPavosPendiente(sock) {
    if (sock) socketAlertasDiariasActivo = sock;
    const partes = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Mexico_City',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());
    const hora = Number(partes.find(p => p.type === 'hour')?.value);
    const minuto = Number(partes.find(p => p.type === 'minute')?.value);
    if (hora < 18 || (hora === 18 && minuto < 1)) return false;
    if (await yaSeEnvioAlertaPavosHoy(fechaCDMX())) return true;
    if (recuperacionAlertaPavosEnCurso) return false;
    if (raspadoEnCurso) {
        // Si el raspado del horario aún está terminando, volver a revisar tras unos segundos.
        setTimeout(() => reanudarAlertaPavosPendiente(socketAlertasDiariasActivo || sock).catch(e =>
            console.error('❌ Error reintentando la recuperación de alertas STW:', e.message)
        ), 15000);
        return false;
    }
    recuperacionAlertaPavosEnCurso = true;
    raspadoEnCurso = true;
    try {
        console.log('🔁 WhatsApp reconectado después de las 6:01 PM: recuperando la alerta diaria pendiente.');
        const { extraerAlertasAPI } = require('../webBridge');
        const resultado = await extraerAlertasAPI();
        if (!resultado || resultado.ok !== true) {
            console.warn('⚠️ No se pudo actualizar STW durante la recuperación; se conserva la caché para el próximo intento.');
            return false;
        }
        const socketEnvio = socketAlertasDiariasActivo || sock;
        const enviada = await enviarAlertaPavosAutomatica(socketEnvio, false, 'recuperación tras reconexión', false);
        if (enviada) console.log('✅ Alerta diaria pendiente enviada tras reconectar WhatsApp.');
        else console.warn('⚠️ La recuperación terminó, pero no se confirmó el envío a todos los grupos configurados.');
        return enviada;
    } catch (error) {
        console.error('❌ Error recuperando la alerta diaria tras reconectar:', error.stack || error.message);
        return false;
    } finally {
        raspadoEnCurso = false;
        recuperacionAlertaPavosEnCurso = false;
    }
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
    obtenerAlertasSTW, alertasSTW, comandoDestacadasSTW, comandoPreguntarAlerta, comandoSubirPL, formatearAlertaSTW, 
    iniciarCronAlertasDiarias, reanudarAlertaPavosPendiente, activarAlertasDiarias, desactivarAlertasDiarias
};

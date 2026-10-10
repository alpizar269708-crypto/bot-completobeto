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

async function obtenerAlertasSTW(actualizarEnVivo = true, progreso = null) {
    let raspadoCorrecto = false;
    if (actualizarEnVivo) {
        try {
            const { extraerAlertasAPI } = require('../webBridge');
            const resultado = await extraerAlertasAPI(progreso);
            raspadoCorrecto = Boolean(resultado && resultado.ok === true);
            if (!raspadoCorrecto) console.warn('STW: las fuentes web no entregaron datos completos; se intentará usar el último caché válido.');
        } catch (error) {
            console.error('No se pudo actualizar STW:', error.stack || error.message);
        }
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
        errorActualizacion: actualizarEnVivo && !raspadoCorrecto && !hayCache
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
        const cantidadEncontrada = Number(recompensa.cantidad || 0) ||
            Number((String(recompensa.nombre || '').match(/[x×]\s*(\d+)/i) || [])[1] || 0);
        return icono + ' Perk-Up' + (rarezaEs ? ' ' + rarezaEs : '') + (cantidadEncontrada > 0 ? ' ×' + cantidadEncontrada : '');
    }
    const traductores = traductoresSTW();
    if (typeof traductores.normalizarRecompensaSTW === 'function') {
        return traductores.normalizarRecompensaSTW(recompensa.raw || recompensa.nombre || '', recompensa.rareza, tipo);
    }
    return String(recompensa.nombre || recompensa.raw || '').trim();
}

function obtenerRecompensasValiosasSTW(item) {
    const recompensas = Array.isArray(item.recompensas) ? item.recompensas : [];
    const rarezasPerkUp = new Set(recompensas.filter(r => r && r.tipo === 'perkup').map(r => r.rareza));
    const tienePerkUpDoble = rarezasPerkUp.has('epic') && rarezasPerkUp.has('legendary');
    const valiosas = recompensas.filter(r => {
        if (!r || !r.tipo) return false;
        if (r.tipo === 'vbucks') return true;
        if (r.tipo === 'perkup') return tienePerkUpDoble && ['epic', 'legendary'].includes(r.rareza);
        if (!['hero', 'survivor', 'defender', 'schematic'].includes(r.tipo)) return false;
        return ['mythic', 'legendary', 'epic', 'rare'].includes(r.rareza);
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
    // Los multiplicadores x4/x5 no se muestran en ningún comando.
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
    const bioma = biomaOriginal && typeof traducirBioma === 'function'
        ? traducirBioma(biomaOriginal)
        : biomaOriginal;
    return [nombre, bioma && !/^zona desconocida$/i.test(bioma) ? bioma : ''].filter(Boolean).join(' - ');
}

function traducirModificadoresSalidaSTW(modificadores) {
    const traductores = traductoresSTW();
    const traducir = traductores.traducirModificadorSTW;
    const list = Array.isArray(modificadores) ? modificadores : [];
    const traducidos = list.map(x => typeof traducir === 'function' ? traducir(x) : x).filter(Boolean);
    return [...new Set(traducidos)];
}

function esRequisitoRealSTW(valor) {
    const texto = String(valor || '').trim();
    return Boolean(texto) && !/^(none|ninguno|ninguna|ningún requisito|sin requisitos|n\/a|na|-)$/i.test(texto);
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
    } else if (item.recompensa && item.recompensa !== 'Misión' && !/^(none|ninguno|ninguna)$/i.test(String(item.recompensa).trim())) {
        texto += '🎁 *Recompensa:* ' + item.recompensa + '\n';
    }

    if (mostrarDetalles) {
        const modificadores = traducirModificadoresSalidaSTW(item.modificadores)
            .filter(modificador => !/\bx[45]\b/i.test(modificador));
        if (modificadores.length) texto += '🧩 *Modificadores:* ' + modificadores.join(', ') + '\n';
        const requisitos = String(item.questReqs || item.requisitos || '').trim();
        if (esRequisitoRealSTW(requisitos)) texto += '📜 *Requisitos:* ' + requisitos + '\n';
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
    const informar = async texto => { if (typeof progreso === 'function') { try { await progreso(texto); } catch (_) {} } };
    let datos;
    try {
        datos = await obtenerAlertasSTW(true, informar);
    } catch (error) {
        console.error('Error cargando alertas STW para comando ' + categoria + ':', error.stack || error.message);
        datos = { pavos: [], epicas: [], legendarias: [], plAltas: [], errorActualizacion: true };
    }

    const fechaHoy = obtenerFechaActual();
    const lineas = ['📅 _' + fechaHoy + '_', ''];
    if (categoria === 'pavos' || categoria === 'todas') {
        lineas.push('🎮 *ALERTAS DE PaVos*', '');
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
            const normalValida = recompensas.some(r => ['hero', 'survivor', 'defender', 'schematic'].includes(r.tipo)
                && ['epic', 'legendary', 'mythic'].includes(r.rareza));
            const perkUpRaro = new Set(recompensas.filter(r => r.tipo === 'perkup').map(r => r.rareza));
            return normalValida || (perkUpRaro.has('epic') && perkUpRaro.has('legendary'));
        });
        const limite = 10;
        if (!lista.length) {
            lineas.push(datos.errorActualizacion
                ? '⚠️ _No pude consultar las fuentes de alertas en este momento._'
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
                ? '⚠️ _No pude consultar las fuentes de alertas en este momento._'
                : '_No hay recompensas de esta rareza en héroes, supervivientes, defensores o esquemas._', '');
        } else {
            for (const alerta of lista) lineas.push(formatearAlertaSTW(alerta));
        }
    }

    lineas.push('Support-a-Creator: *JASC13* ❤️');
    const texto = lineas.join('\n');
    try {
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
    } catch (error) {
        console.error('No se pudo enviar la respuesta del comando STW ' + categoria + ':', error.stack || error.message);
        throw error;
    }
}
async function comandoDestacadasSTW(sock, chatId, msg, progreso = null) {
    const informar = async (texto) => { if (typeof progreso === 'function') await progreso(texto); };
    await informar('🧭 Comando de destacadas iniciado; consultará caché STW Planner y filtrará PL altas.');
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n🔥 *ALERTAS DESTACADAS — RECOMPENSAS BUENAS*\n\n`;

    try {
        await informar('🗄️ ETAPA 1/4 — Leyendo datos guardados en MongoDB.');
        const datos = await obtenerAlertasSTW(true, informar);
        await informar('🔎 ETAPA 2/4 — Seleccionando alertas destacadas de PL altas. Total recibido=' + (datos.plAltas || []).length + '.');
        const listaPlAltas = datos.plAltas || [];

        await informar('🧹 ETAPA 3/4 — Lista seleccionada; elementos a formatear=' + listaPlAltas.length + '.');
        if (listaPlAltas.length === 0) {
            texto += datos.errorActualizacion
                ? '_No pude consultar las fuentes y no hay datos guardados para mostrar._\n\n'
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

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await informar('✅ ETAPA 4/4 — Respuesta de destacadas construida; enviando a WhatsApp.');
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg, palabrasClave = [], progreso = null, mostrarDetalles = false) {
    const informar = async texto => { if (typeof progreso === 'function') { try { await progreso(texto); } catch (_) {} } };
    const nombreComando = mostrarDetalles ? 'alertanob' : 'alerta';
    const termino = Array.isArray(palabrasClave)
        ? palabrasClave.join(' ').trim()
        : String(palabrasClave || '').trim();

    if (!termino) {
        await sock.sendMessage(chatId, { text: '🤖 Escribe después de *' + nombreComando + '* una palabra o frase para buscar en las alertas.' }, { quoted: msg });
        return;
    }

    await informar('🧭 Búsqueda de recompensa iniciada; término=' + termino + '.');
    const datos = await obtenerAlertasSTW(true, informar);
    await informar('🔎 ETAPA 1/3 — Datos cargados; combinando PaVos, épicas, legendarias y destacadas para buscar coincidencias.');
    const hayDatosDisponibles = datos.pavos.length + datos.epicas.length + datos.legendarias.length + (datos.plAltas || []).length > 0;
    if (datos.errorActualizacion && !hayDatosDisponibles) {
        await sock.sendMessage(chatId, { text: '⚠️ No pude consultar STW Planner, SeeBot ni V-Bucks Daily, y no hay alertas guardadas para buscar. Inténtalo de nuevo en un momento.' }, { quoted: msg });
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
            item.mision,
            item.misionOriginal,
            item.zona,
            item.nombre,
            item.recompensa,
            ...(Array.isArray(item.recompensas) ? item.recompensas.map(r => typeof r === 'string' ? r : (r.nombre || r.raw || '')) : []),
            item.cantidad,
            item.cantidadVbucks,
            item.tipoAlertaTexto
        ].filter(Boolean).join(' '));
        return textoBusqueda.includes(clave);
    });

    // Una misión que coincide en varias categorías solo debe verse una vez.
    const mapaCoincidencias = new Map();
    for (const item of coincidenciasFiltradas) {
        const normalizarClave = valor => normalizarTexto(valor).replace(/\s+/g, ' ').trim();
        const claveMision = [
            normalizarClave(item.zona),
            Number(item.pl || 0),
            normalizarClave(item.misionOriginal || item.mision),
            normalizarClave(item.ubicacion)
        ].join('|');
        const anterior = mapaCoincidencias.get(claveMision);
        if (!anterior) {
            mapaCoincidencias.set(claveMision, {
                ...item,
                categoria: [item.categoria],
                recompensas: [...(item.recompensas || [])],
                modificadores: [...(item.modificadores || [])]
            });
            continue;
        }
        const categorias = [...new Set([...(Array.isArray(anterior.categoria) ? anterior.categoria : [anterior.categoria]), item.categoria])];
        const recompensas = [...(anterior.recompensas || [])];
        const clavesRecompensa = new Set(recompensas.map(r => typeof r === 'string' ? r.toLowerCase() : [r.tipo, r.rareza, r.raw || r.nombre].join('|').toLowerCase()));
        for (const recompensa of (item.recompensas || [])) {
            const k = typeof recompensa === 'string' ? recompensa.toLowerCase() : [recompensa.tipo, recompensa.rareza, recompensa.raw || recompensa.nombre].join('|').toLowerCase();
            if (!clavesRecompensa.has(k)) { clavesRecompensa.add(k); recompensas.push(recompensa); }
        }
        const modificadores = [...new Set([...(anterior.modificadores || []), ...(item.modificadores || [])])];
        mapaCoincidencias.set(claveMision, {
            ...anterior,
            ...item,
            categoria: categorias,
            recompensas,
            modificadores,
            recompensa: recompensas.map(r => typeof r === 'string' ? r : r.nombre).filter(Boolean).join(' | ') || item.recompensa || anterior.recompensa,
            questReqs: anterior.questReqs || item.questReqs,
            requisitos: anterior.requisitos || item.requisitos
        });
    }
    const coincidencias = Array.from(mapaCoincidencias.values());
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
            const categorias = Array.isArray(item.categoria) ? item.categoria : [item.categoria];
            texto += '📌 *' + [...new Set(categorias)].join(' / ') + '*\n';
            texto += formatearAlertaSTW(item, '', mostrarDetalles);
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

        // El cron pasa actualizarEnVivo=true: refrescar primero las fuentes públicas
        // y después leer lo guardado para no publicar alertas viejas por accidente.
        const datos = await obtenerAlertasSTW(actualizarEnVivo);

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
            const cantidad = Number(p.cantidad || p.cantidadVbucks || 50);
            mensajeAuto += '🌍 *Zona:* ' + (p.zona || 'Desconocida') + '\n';
            mensajeAuto += '⚡ *PL:* ' + (p.pl ?? '?') + '\n';
            mensajeAuto += '🎯 *Misión:* ' + (p.mision || p.misionOriginal || 'Alerta de PaVos') + '\n';
            mensajeAuto += '🪙 *PaVos:* ' + cantidad + '\n';
            mensajeAuto += '\n';
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

    // Calentar la caché al iniciar el bot para que los comandos tengan datos
    // recientes incluso si la primera consulta manual falla.
    void (async () => {
        try {
            console.log('🌐 Actualización inicial de alertas STW: consultando STW Planner y SeeBot.');
            const { extraerAlertasAPI } = require('../webBridge');
            const resultado = await extraerAlertasAPI();
            if (resultado && resultado.ok) {
                console.log('✅ Caché STW inicial lista | misiones=' + (resultado.total || 0) +
                    ' | PaVos=' + (resultado.pavos || 0) +
                    ' | épicas=' + (resultado.epicas || 0) +
                    ' | legendarias=' + (resultado.legendarias || 0) +
                    ' | destacadas=' + (resultado.plAltas || 0));
            } else {
                console.warn('⚠️ No se pudo calentar la caché STW al iniciar; los comandos volverán a consultar las fuentes en vivo.');
            }
        } catch (error) {
            console.error('❌ Falló la actualización inicial STW:', error.stack || error.message);
        }
    })();
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

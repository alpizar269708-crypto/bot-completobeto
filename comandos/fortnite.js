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
    let fuentes = null;
    if (actualizarEnVivo) {
        try {
            const { extraerAlertasAPI } = require('../webBridge');
            const resultado = await extraerAlertasAPI(progreso);
            raspadoCorrecto = Boolean(resultado && resultado.ok === true);
            fuentes = resultado && resultado.fuentes ? resultado.fuentes : null;
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
        errorActualizacion: actualizarEnVivo && !raspadoCorrecto && !hayCache,
        fuentes
    };
}


function traducirRecompensaSalidaSTW(recompensa) {
    let nombre = String(recompensa && (recompensa.nombre || recompensa.raw) || '').trim();
    if (!nombre) return '';
    nombre = nombre
        .replace(/\bScouting Party Lead\s+Survivor\b/ig, 'Líder del grupo de exploración')
        .replace(/\bTraining Team Lead\s+Survivor\b/ig, 'Líder del equipo de entrenamiento')
        .replace(/\bScouting Party Lead\b/ig, 'Líder del grupo de exploración')
        .replace(/\bTraining Team Lead\b/ig, 'Líder del equipo de entrenamiento')
        .replace(/\s+Survivor\b/ig, '')
        .replace(/\bEpic PERK-UP!?/ig, 'Perk-Up épico')
        .replace(/\bLegendary PERK-UP!?/ig, 'Perk-Up legendario')
        .replace(/\bMythic PERK-UP!?/ig, 'Perk-Up mítico')
        .replace(/\bRare PERK-UP!?/ig, 'Perk-Up raro')
        .replace(/\bHero\b/ig, 'Héroe')
        .replace(/\bDefender\b/ig, 'Defensor')
        .replace(/\bSchematic\b/ig, 'Esquema')
        .replace(/\bLegendary\b/ig, 'legendario')
        .replace(/\bEpic\b/ig, 'épico')
        .replace(/\bMythic\b/ig, 'mítico')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return nombre;
}

function obtenerRecompensasValiosasSTW(item) {
    const recompensas = Array.isArray(item.recompensas) ? item.recompensas : [];
    const valiosas = recompensas.filter(r => {
        if (!r || !r.tipo) return false;
        if (r.tipo === 'vbucks') return true;
        if (!['hero', 'survivor', 'defender', 'schematic', 'perkup'].includes(r.tipo)) return false;
        return ['mythic', 'legendary', 'epic', 'rare'].includes(r.rareza);
    });
    const unicas = [];
    const vistos = new Set();
    for (const recompensa of valiosas) {
        const nombre = traducirRecompensaSalidaSTW(recompensa);
        const clave = nombre.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!clave || vistos.has(clave)) continue;
        vistos.add(clave);
        unicas.push(nombre);
    }
    return unicas;
}

function formatearMultiplicadorSTW(item) {
    const multiplicador = Number(item.multiplicadorRecompensa);
    if (multiplicador === 4) return '✖️ *Recompensa x4:* Sí\n';
    if (multiplicador === 5) return '✖️ *Recompensa x5:* Sí\n';
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
    if (!fuente || typeof traducirNombre !== 'function') return fuente;
    const partes = fuente.split(/\s+-\s+/);
    const nombreOriginal = partes.shift();
    const nombre = traducirNombre(nombreOriginal) || nombreOriginal;
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

function formatearAlertaSTW(item, encabezado = '', detallada = false) {
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
    } else if (item.recompensa && item.recompensa !== 'Misión' && !/\b(?:x4|x5)\b|recompensa\s*x[45]/i.test(String(item.recompensa))) {
        texto += '🎁 *Recompensa:* ' + traducirRecompensaSalidaSTW({ nombre: item.recompensa }) + '\n';
    }

    // Solo alertanob enseña modificadores y requisitos de la misión.
    // Los multiplicadores x4/x5 nunca se muestran en ningún comando.
    if (detallada) {
        const modificadores = traducirModificadoresSalidaSTW(item.modificadores);
        if (modificadores.length) texto += '🧩 *Modificadores:* ' + modificadores.join(', ') + '\n';
        const requisitos = String(item.questReqs || item.requisitos || '').trim();
        if (requisitos && !/^(?:none|ninguno|ninguna)$/i.test(requisitos)) {
            texto += '📜 *Requisitos:* ' + traducirRequisitosSalidaSTW(requisitos) + '\n';
        }
    }
    return texto + '\n';
}

function traducirRequisitosSalidaSTW(requisitos) {
    return String(requisitos || '').trim()
        .replace(/\bcomplete one mission in a (\d+)\+? zone\b/ig, 'Completa una misión en una zona de nivel $1 o superior')
        .replace(/\bcomplete one mission\b/ig, 'Completa una misión')
        .replace(/\bcomplete\b/ig, 'completa')
        .replace(/\bmissions?\b/ig, 'misión')
        .replace(/\bquests?\b/ig, 'objetivo')
        .replace(/\bnone\b/ig, 'ninguno')
        .replace(/\bdefeat\b/ig, 'derrota')
        .replace(/\beliminate\b/ig, 'elimina')
        .replace(/\bcollect\b/ig, 'reúne')
        .replace(/\bsurvivors?\b/ig, 'supervivientes')
        .replace(/\bstorm\b/ig, 'tormenta')
        .replace(/\bzone\b/ig, 'zona')
        .replace(/\bpower\s+level\b/ig, 'nivel de poder')
        .replace(/\bone\b/ig, 'una')
        .replace(/\bany\b/ig, 'cualquier')
        .replace(/\bin\b/ig, 'en')
        .replace(/\bat\b/ig, 'en')
        .replace(/\bor\b/ig, 'o')
        .replace(/\bhigher\b/ig, 'superior')
        .replace(/\bwith\b/ig, 'con')
        .replace(/\ba\b/ig, 'una')
        .replace(/\s+/g, ' ')
        .trim();
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
            // Incluir filas con PaVos aunque no tengan otra recompensa rara.
            // Esto hace que el resumen general refleje también las alertas de PaVos.
            return recompensas.some(r => r && (
                r.tipo === 'vbucks' ||
                (['hero', 'survivor', 'defender', 'schematic', 'perkup'].includes(r.tipo)
                    && ['epic', 'legendary', 'mythic'].includes(r.rareza))
            ));
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
    await informar('🔎 Preparando las alertas destacadas.');
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

async function comandoPreguntarAlerta(sock, chatId, msg, palabrasClave = [], progreso = null, detallada = false) {
    const informar = async texto => { if (typeof progreso === 'function') { try { await progreso(texto); } catch (_) {} } };
    const termino = Array.isArray(palabrasClave)
        ? palabrasClave.join(' ').trim()
        : String(palabrasClave || '').trim();

    if (!termino) {
        await sock.sendMessage(chatId, { text: '🤖 Escribe después de *' + (detallada ? 'alertanob' : 'alerta') + '* una palabra o frase para buscar en las alertas.' }, { quoted: msg });
        return;
    }

    await informar('🔎 Iniciando búsqueda de alertas.');
    const datos = await obtenerAlertasSTW(true, informar);
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

    const mapaCoincidencias = new Map();
    for (const item of [
        ...datos.pavos.map(item => ({ ...item, categoria: 'PaVos' })),
        ...datos.epicas.map(item => ({ ...item, categoria: 'Épicas' })),
        ...datos.legendarias.map(item => ({ ...item, categoria: 'Legendarias' })),
        ...(datos.plAltas || []).map(item => ({ ...item, categoria: 'Destacadas' }))
    ]) {
        const normalizarClave = valor => String(valor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
        const claveMision = [normalizarClave(item.zona), String(item.pl || ''), normalizarClave(item.misionOriginal || item.mision), normalizarClave(item.ubicacion)].join('|');
        if (!mapaCoincidencias.has(claveMision)) {
            mapaCoincidencias.set(claveMision, { ...item, recompensas: [...(item.recompensas || [])], categorias: [item.categoria] });
            continue;
        }
        const anterior = mapaCoincidencias.get(claveMision);
        const recompensas = [...(anterior.recompensas || [])];
        const vistas = new Set(recompensas.map(r => normalizarClave((r.tipo || '') + ' ' + (r.rareza || '') + ' ' + (r.raw || r.nombre))));
        for (const r of (item.recompensas || [])) {
            const claveR = normalizarClave((r.tipo || '') + ' ' + (r.rareza || '') + ' ' + (r.raw || r.nombre));
            if (!vistas.has(claveR)) { vistas.add(claveR); recompensas.push(r); }
        }
        mapaCoincidencias.set(claveMision, { ...anterior, recompensas, categorias: [...new Set([...(anterior.categorias || []), item.categoria])] });
    }
    const coincidencias = Array.from(mapaCoincidencias.values()).filter(item => {
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
            texto += '📌 *' + (item.categorias || [item.categoria]).join(' · ') + '*\n';
            texto += formatearAlertaSTW(item, '', detallada);
        });
    }

    texto += 'Support-a-Creator: *JASC13* ❤️';
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
        (['hero', 'survivor', 'defender', 'schematic', 'perkup'].includes(r.tipo) &&
         ['mythic', 'legendary', 'epic'].includes(r.rareza))
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

async function enviarAlertaPavosAutomatica(sock, actualizarEnVivo = false, horaAlerta = '6:01:30 PM', avisarSinPavos = false) {
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

        const datos = await obtenerAlertasSTW(actualizarEnVivo);
        const docEstado = await Config.findOne({ clave: CLAVE_ESTADO_ALERTA_PAVOS });
        let estado = {};
        try { estado = docEstado && docEstado.valor ? JSON.parse(docEstado.valor) : {}; } catch (_) {}
        const firmasAnteriores = estado.firmasPorFuente || {};
        const fuentes = datos.fuentes || {};
        let seleccionadas = [];

        // Primero se prueba la fuente principal; si no hay cambios, se intenta
        // la segunda y después la tercera. Solo se publica la primera que cambió.
        for (const nombreFuente of ['principal', 'secundaria', 'tercera']) {
            const candidatas = combinarAlertasDiarias(fuentes[nombreFuente] || []);
            if (!candidatas.length) continue;
            const firmasPrevias = firmasAnteriores[nombreFuente] || {};
            const nuevas = candidatas.filter(item =>
                firmasPrevias[claveMisionAlertaDiaria(item)] !== firmaMisionAlertaDiaria(item)
            );
            if (nuevas.length) {
                seleccionadas = nuevas;
                break;
            }
        }

        // No se manda una falsa alerta ni un aviso de "sin PaVos". El siguiente
        // horario vuelve a raspar; una misión nueva sirve aunque no tenga PaVos.
        if (!seleccionadas.length && horaAlerta === '6:05 PM') {
            // Último respaldo: si ninguna fuente confirma un cambio, conservar
            // una sola alerta de la primera fuente disponible, sin unir listas.
            for (const nombreFuente of ['principal', 'secundaria', 'tercera']) {
                const primera = combinarAlertasDiarias(fuentes[nombreFuente] || [])
                    .sort((a, b) => Number(b.pl || 0) - Number(a.pl || 0))[0];
                if (primera) { seleccionadas = [primera]; break; }
            }
        }
        if (!seleccionadas.length) {
            console.log('🔎 Alertas diarias: sin cambios nuevos; se intentará de nuevo en el siguiente horario.');
            return false;
        }

        seleccionadas = combinarAlertasDiarias(seleccionadas)
            .sort((a, b) => Number(b.pl || 0) - Number(a.pl || 0))
            .slice(0, 10);
        let mensajeAuto = '🎮 *ALERTAS DIARIAS — ' + horaAlerta + '*\n\n';
        for (const item of seleccionadas) mensajeAuto += formatearAlertaSTW(item);
        mensajeAuto += '🔎 Usa *stw* para consultar el concentrado completo.';

        let enviada = false;
        for (const grupo of grupos) {
            try {
                await sock.sendMessage(grupo, { text: mensajeAuto });
                enviada = true;
            } catch (e) {
                console.error('Error enviando alerta diaria al grupo:', e.message);
            }
        }
        if (enviada) {
            await guardarAlertaPavosEnviada(fechaCDMX(), horaAlerta, firmasPorFuenteAlertaDiaria(fuentes));
        }
        return enviada;
    } catch (error) {
        console.error('Error en alerta diaria:', error.message);
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
                    console.log(`⏭️ Se omite el raspado de las ${horario.etiqueta}: la alerta diaria ya fue enviada hoy.`);
                    return;
                }

                raspadoEnCurso = true;
                const enviada = await enviarAlertaPavosAutomatica(sock, true, horario.etiqueta, horario.avisarSinPavos);
                if (enviada) {
                    console.log(`✅ Alerta diaria enviada a las ${horario.etiqueta}; estado y firmas guardados para evitar duplicados tras reinicios.`);
                } else {
                    console.log(`🔎 ${horario.etiqueta}: no se detectó una alerta nueva; se continuará con el siguiente horario si queda alguno.`);
                }
            } catch (e) {
                console.error(`❌ Error en el horario ${horario.etiqueta}:`, e.message);
            } finally {
                raspadoEnCurso = false;
            }
        }, { scheduled: true, timezone: zonaHoraria });
    }

    console.log('🕒 Alertas diarias programadas a las 18:01:30, 18:02 y 18:05 (hora de Ciudad de México). Se publican cambios nuevos y, al final, un solo respaldo si no hubo cambios.');

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
    obtenerAlertasSTW, alertasSTW, comandoDestacadasSTW, comandoPreguntarAlerta, formatearAlertaSTW, obtenerRecompensasValiosasSTW, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias
};

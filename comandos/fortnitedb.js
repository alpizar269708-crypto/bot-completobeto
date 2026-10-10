const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('../database/modelos');
const { traducirNombreMisionSTW, traducirZonaSTW, traducirModificadorSTW, parsearJSONSeeBotSTW } = require('../webBridge');

const URL_SEEBOT = 'https://seebot.dev/missions.php';


const ZONAS = {
    S: 'Stonewood',
    P: 'Plankerton',
    C: 'Canny Valley',
    T: 'Twine Peaks',
    V: 'Ventures'
};

function limpiar(texto) {
    return String(texto || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function nombreMisionSeeBot(nombre) {
    return traducirNombreMisionSTW(nombre) || nombre || 'Misión de alerta';
}

let progresoGeneralReportado = false;
async function reportar(progreso, texto) {
    if (typeof progreso !== 'function' || progresoGeneralReportado) return;
    progresoGeneralReportado = true;
    try {
        await progreso('⏳ Consultando las alertas. Esto puede tardar unos segundos.');
    } catch (e) {
        console.error('No se pudo enviar una actualización:', e.message);
    }
}

async function descargarPagina(url, timeout = 12000) {
    const respuesta = await axios.get(url, {
        timeout,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    return respuesta;
}

function detalleErrorHTTP(error) {
    const status = error?.response?.status;
    const headers = error?.response?.headers || {};
    const cuerpo = typeof error?.response?.data === 'string' ? error.response.data : '';
    const pista = limpiar(cuerpo.replace(/<[^>]*>/g, ' ')).slice(0, 180);
    return [
        status ? 'HTTP ' + status : null,
        error?.code || null,
        headers['content-type'] ? 'content-type=' + headers['content-type'] : null,
        headers.server ? 'server=' + headers.server : null,
        pista ? 'respuesta=' + pista : null,
        !status && error?.message ? error.message : null
    ].filter(Boolean).join(' | ') || 'error sin detalle';
}

function extraerDatosSeeBot(html) {
    // Solo acepta una llamada makeHtml([ ... ]); evita confundirla con la
    // declaración de la función makeHtml(misiones).
    const patrones = [
        /makeHtml\s*\(\s*(\[)/i
    ];
    let inicioLlamada = -1;
    for (const patron of patrones) {
        const coincidencia = patron.exec(html);
        if (coincidencia) { inicioLlamada = coincidencia.index; break; }
    }
    if (inicioLlamada < 0) {
        const pistas = [];
        if (/cloudflare|checking your browser|just a moment/i.test(html)) pistas.push('parece una página de protección anti-bots');
        if (/application\/json|__NEXT_DATA__|mission|alertRewards/i.test(html)) pistas.push('hay indicios de datos alternativos incrustados');
        throw new Error('No encontré makeHtml(...) en SeeBot.dev' +
            (pistas.length ? ' (' + pistas.join('; ') + ')' : '') +
            '. HTML recibido: ' + String(html || '').length + ' caracteres.');
    }

    const inicioJson = html.indexOf('[', inicioLlamada);
    const cierreScript = html.indexOf('</script>', inicioJson);
    if (inicioJson < 0 || (cierreScript >= 0 && inicioJson > cierreScript)) {
        throw new Error('Se encontró makeHtml, pero no comienza un arreglo JSON dentro del script.');
    }

    // Encuentra el cierre real del arreglo, respetando corchetes dentro de strings.
    let profundidad = 0, enString = false, escape = false, finJson = -1;
    for (let i = inicioJson; i < html.length; i++) {
        if (cierreScript >= 0 && i >= cierreScript) break;
        const ch = html[i];
        if (enString) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') enString = false;
            continue;
        }
        if (ch === '"') { enString = true; continue; }
        if (ch === '[') profundidad++;
        if (ch === ']') {
            profundidad--;
            if (profundidad === 0) { finJson = i + 1; break; }
        }
    }
    if (finJson < 0) throw new Error('El arreglo de misiones de SeeBot está incompleto o cambió de formato.');

    let misiones;
    try {
        misiones = JSON.parse(html.slice(inicioJson, finJson));
    } catch (error) {
        throw new Error('Encontré el arreglo de misiones, pero el JSON no se pudo interpretar: ' + error.message);
    }
    if (!Array.isArray(misiones)) throw new Error('El bloque de SeeBot no contiene una lista de misiones.');
    return misiones;
}


function extraerAlertasSeeBotTabla(html) {
    const $ = cheerio.load(String(html || ''));
    const tabla = $('#miniRwdTbl');
    if (!tabla.length) return [];
    const alertas = [];
    tabla.find('tr.missionRow').each((_, fila) => {
        const celdas = $(fila).children('td');
        if (celdas.length < 6) return;
        const zona = limpiar($(celdas[0]).text());
        const poder = limpiar($(celdas[1]).text()).match(/\d+/);
        const misionImg = $(celdas[2]).find('img').first();
        const nombreOriginal = limpiar(misionImg.attr('title') || misionImg.attr('alt') || $(celdas[2]).text());
        const textoRecompensa = limpiar($(celdas[4]).text());
        const coincide = textoRecompensa.match(/(?:V-?Bucks|V\s*Bucks)[^0-9]{0,50}(\d+)/i);
        if (!coincide) return;
        const cantidad = Number(coincide[1]);
        if (!Number.isFinite(cantidad) || cantidad <= 0) return;
        const modificadores = $(celdas[3]).find('img').map((__, img) =>
            limpiar($(img).attr('title') || $(img).attr('alt')).split(':')[0]
        ).get().filter(Boolean);
        alertas.push({
            zona,
            zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T', Ventures: 'V' })[zona] || null,
            pl: poder ? Number(poder[0]) : null,
            mision: nombreMisionSeeBot(nombreOriginal),
            misionOriginal: nombreOriginal,
            cantidad,
            recompensaOriginal: textoRecompensa,
            tipoRecompensa: /or\s+X-Ray/i.test(textoRecompensa) ? 'V-Bucks or X-Ray' : 'V-Bucks',
            modificadores,
            requisitos: limpiar($(celdas[5]).text()) || 'None'
        });
    });
    return alertas;
}
async function consultarSeeBot(progreso) {
    const resultado = { fuente: 'SeeBot.dev', url: URL_SEEBOT, alertas: [], error: null, etapas: [] };
    const inicio = Date.now();
    const paso = async (texto) => {
        const marcado = '[' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s] ' + texto;
        resultado.etapas.push(marcado);
        await reportar(progreso, marcado);
    };

    try {
        await paso('🔬 *SeeBot ETAPA 1 — CONEXIÓN:* GET ' + URL_SEEBOT + '; timeout 25 s; redirecciones máximas 5.');
        const respuesta = await descargarPagina(URL_SEEBOT, 25000);
        resultado.http = respuesta.status;
        resultado.contentType = respuesta.headers?.['content-type'] || 'desconocido';
        resultado.responseUrl = respuesta.request?.res?.responseUrl || URL_SEEBOT;
        const html = String(respuesta.data || '');
        await paso('📥 *SeeBot ETAPA 2 — RESPUESTA:* HTTP ' + respuesta.status + '; URL final=' + resultado.responseUrl + '; content-type=' + resultado.contentType + '; bytes/caracteres=' + html.length + '.');

        const $see = cheerio.load(html);
        await paso('🧩 *SeeBot ETAPA 3 — HTML:* título=' + (limpiar($see('title').first().text()) || '(sin title)') + '; scripts=' + $see('script').length + '; contiene makeHtml=' + /makeHtml\s*\(/i.test(html) + '; señales anti-bot=' + /cloudflare|checking your browser|just a moment/i.test(html) + '.');
        await paso('🔎 *SeeBot ETAPA 4 — RUTA A:* leyendo la tabla HTML #miniRwdTbl, especialmente td.missionAlerts.');
        const alertasTabla = extraerAlertasSeeBotTabla(html);
        if (alertasTabla.length > 0) {
            resultado.alertas = alertasTabla;
            resultado.rutaExtraccion = 'HTML #miniRwdTbl';
            await paso('📋 *SeeBot ETAPA 5 — TABLA HTML:* alertas V-Bucks encontradas=' + alertasTabla.length + '; se conservaron misión, modificadores, requisitos y texto de recompensa.');
        } else {
            await paso('↪️ SeeBot: la tabla #miniRwdTbl no produjo filas directas; intentando primero el parser unificado del JSON makeHtml(...).');
            const normalizadas = parsearJSONSeeBotSTW(html);
            for (const mision of normalizadas) {
                const recompensaPavos = (Array.isArray(mision.recompensas) ? mision.recompensas : [])
                    .find(r => r && r.tipo === 'vbucks');
                if (!mision.vbucks && !recompensaPavos) continue;
                const cantidad = Number(mision.cantidadVbucks || recompensaPavos?.cantidad || 50);
                if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
                const zona = String(mision.zona || '').trim();
                resultado.alertas.push({
                    zona,
                    zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T', Ventures: 'V' })[zona] || null,
                    pl: Number(mision.pl) || null,
                    mision: mision.mision || nombreMisionSeeBot(mision.misionOriginal),
                    misionOriginal: mision.misionOriginal || mision.mision,
                    cantidad,
                    tipoRecompensa: /or\s+X-Ray/i.test(String(recompensaPavos?.raw || '')) ? 'V-Bucks or X-Ray' : 'V-Bucks',
                    modificadores: Array.isArray(mision.modificadores) ? mision.modificadores : [],
                    questReqs: mision.questReqs || 'None',
                    requisitos: mision.questReqs || 'None',
                    source: mision.source || URL_SEEBOT
                });
            }
            if (resultado.alertas.length) {
                resultado.rutaExtraccion = 'JSON makeHtml normalizado';
                await paso('📋 *SeeBot ETAPA 5 — DATOS JSON NORMALIZADOS:* misiones completas leídas=' + normalizadas.length +
                    '; alertas de PaVos=' + resultado.alertas.length + '; se conservaron modificadores y requisitos.');
            } else {
                // Compatibilidad: mantener el parser anterior si SeeBot cambia
                // los nombres de campos de recompensas en su JSON.
                const misiones = extraerDatosSeeBot(html);
                resultado.rutaExtraccion = 'JSON makeHtml (compatibilidad)';
                await paso('📋 *SeeBot ETAPA 5 — RESPALDO JSON:* misiones leídas=' + misiones.length + '; filtrando recompensas de PaVos.');
                for (const mision of misiones) {
                    const zona = String(mision.zone || '').trim();
                    if (!['Stonewood', 'Plankerton', 'Canny Valley', 'Twine Peaks', 'Ventures'].includes(zona)) continue;
                    const recompensas = Array.isArray(mision.alertRewards) ? mision.alertRewards : [];
                    const recompensaPavos = recompensas.find(r => /v-?bucks|v\s*bucks|currency_mtxswap|mtxswap/i.test(String(r.itemType || '') + ' ' + String(r.name || '') + ' ' + String(r.id || '')));
                    if (!recompensaPavos) continue;
                    const cantidad = Number(recompensaPavos.quantity);
                    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
                    resultado.alertas.push({
                        zona,
                        zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T', Ventures: 'V' })[zona] || null,
                        pl: Number(mision.powerLevel) || null,
                        mision: nombreMisionSeeBot(mision.name),
                        misionOriginal: mision.name,
                        cantidad,
                        tipoRecompensa: 'V-Bucks'
                    });
                }
            }
        }

        await paso('🧮 *SeeBot ETAPA 6 — FILTRO:* ruta=' + (resultado.rutaExtraccion || 'sin ruta') + '; alertas con recompensa V-Bucks=' + resultado.alertas.length + '.');
        if (resultado.alertas.length === 0) {
            throw new Error('ETAPA 6/7 FILTRO: no se encontraron alertas V-Bucks ni en #miniRwdTbl ni en el arreglo JSON makeHtml(...). La página respondió, pero ambas rutas quedaron sin resultados.');
        }
        resultado.totalPavos = resultado.alertas.reduce((suma, alerta) => suma + alerta.cantidad, 0);
        resultado.ok = true;
        await paso('✅ *SeeBot ETAPA 7 — VALIDACIÓN FINAL:* extracción completa; ' + resultado.alertas.length + ' alertas, total ' + resultado.totalPavos + ' PaVos; duración ' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s.');
    } catch (error) {
        resultado.error = error.message || String(error);
        resultado.ok = false;
        resultado.etapaFallo = resultado.etapas.length ? resultado.etapas[resultado.etapas.length - 1] : 'inicio';
        await paso('❌ *SEEBOT.DEV FALLÓ:* último punto registrado=' + resultado.etapaFallo + ' | causa=' + detalleErrorHTTP(error) + ' | duración=' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s.');
    }
    return resultado;
}

async function diagnosticarMenuFortnite(progreso) {
    const resultado = { fuente: 'Menú Fortnite / STW Planner', ok: true, pruebas: [], errores: [] };
    const paso = async (texto) => { resultado.pruebas.push(texto); await reportar(progreso, texto); };
    const claves = [
        { clave: 'stw_pavos_scrapeados', nombre: 'pavos', comando: 'pavos' },
        { clave: 'stw_epicas_scrapeadas', nombre: 'épicas', comando: 'epicasstw' },
        { clave: 'stw_legendarias_scrapeadas', nombre: 'legendarias', comando: 'legendariasstw' },
        { clave: 'stw_plaltas_scrapeadas', nombre: 'PL altas/destacadas', comando: 'destacadasstw' }
    ];
    const comandos = ['rpavos', 'rdestacadasstw', 'repicasstw', 'rlegendariasstw', 'ralertasstw', 'ralerta', 'rdiagnostico', 'rsetprecio', 'rsetgrupostw', 'runsetgrupostw', 'rcarryleader', 'rcarryjoin', 'rcarryleave', 'rcarryclose', 'rblcarry', 'runblcarry', 'rlistcarrybl'];
    await paso('🧭 *Menú Fortnite:* comprobando raspado en vivo, cachés y cobertura de todos los comandos del menú (incluidos PL altas y carry).');
    // El raspado de STW Planner está suspendido temporalmente, incluso en diagnósticos.
    // Solo leemos la marca de la última actualización ya guardada, sin hacer peticiones web.
    let marcaAnterior = null;
    try {
        const anterior = await Config.findOne({ clave: 'stw_ultima_actualizacion' }).lean();
        if (anterior?.valor) { try { marcaAnterior = JSON.parse(anterior.valor).actualizadoEn || null; } catch (e) {} }
        await paso('⏸️ STW Planner: raspado suspendido temporalmente; no se hará una extracción web. Última actualización guardada=' + (marcaAnterior || 'sin registro') + '.');
    } catch (error) {
        resultado.ok = false;
        resultado.errores.push('No se pudo leer la marca guardada de STW Planner: ' + error.message);
        await paso('❌ No se pudo leer la marca guardada de STW Planner: ' + error.message + '.');
    }
    for (const item of claves) {
        try {
            const doc = await Config.findOne({ clave: item.clave }).lean();
            if (!doc?.valor) {
                resultado.ok = false;
                resultado.errores.push(item.nombre + ': no existe caché (' + item.clave + ').');
                await paso('❌ ' + item.nombre + ': falta el registro ' + item.clave + '.');
                continue;
            }
            const datos = JSON.parse(doc.valor);
            if (!Array.isArray(datos)) throw new Error('el contenido guardado no es una lista');
            const conDatos = datos.length > 0;
            await paso((conDatos ? '✅ ' : '⚠️ ') + item.nombre + ': JSON válido, ' + datos.length + ' registros' + (conDatos ? '.' : ' (lista vacía).'));
            if (!conDatos) {
                resultado.ok = false;
                resultado.errores.push(item.nombre + ': caché vacía.');
            }
        } catch (error) {
            resultado.ok = false;
            resultado.errores.push(item.nombre + ': ' + error.message);
            await paso('❌ ' + item.nombre + ': error leyendo o validando datos — ' + error.message + '.');
        }
    }
    // Compara los comandos del menú con los comandos reconocidos por el manejador.
    try {
        const fs = require('fs');
        const path = require('path');
        const handler = fs.readFileSync(path.join(__dirname, '..', 'messageHandler.js'), 'utf8');
        const menu = fs.readFileSync(path.join(__dirname, 'menu.js'), 'utf8');
        for (const comando of comandos) {
            const registrado = handler.includes("'" + comando + "'") || handler.includes('"' + comando + '"');
            const anunciado = menu.includes(comando);
            const correcto = registrado && anunciado;
            await paso((correcto ? '✅ ' : '❌ ') + 'Comando R ' + comando + ': ' +
                (registrado ? 'registrado en el manejador' : 'NO aparece registrado') + '; ' +
                (anunciado ? 'mencionado en el menú' : 'NO aparece en el texto del menú') + '.');
            if (!correcto) {
                resultado.ok = false;
                resultado.errores.push('Comando ' + comando + ': discrepancia entre menú y manejador.');
            }
        }
    } catch (error) {
        resultado.ok = false;
        resultado.errores.push('No se pudieron revisar los archivos del menú: ' + error.message);
        await paso('❌ No se pudieron revisar los archivos del menú: ' + error.message + '.');
    }
    return resultado;
}

function formatearFuente(resultado) {
    const lineas = [
        (resultado.ok ? '✅' : '❌') + ' *' + resultado.fuente + '*',
        resultado.ok ? 'Alertas encontradas: ' + resultado.alertas.length : 'Último punto: ' + (resultado.etapaFallo || 'no registrado') + '\nError exacto: ' + resultado.error
    ];
    if (resultado.ok) {
        for (const alerta of resultado.alertas) {
            lineas.push('• ' + alerta.zona + ' — PL ' + (alerta.pl ?? '?') + ' — ' + alerta.mision + ' — ' + alerta.cantidad + ' PaVos');
        }
        lineas.push('*Total: ' + resultado.totalPavos + ' PaVos*');
    }
    return lineas.join('\n');
}


const FUENTES_ALTERNATIVAS_PAVOS = [
    { nombre: 'V-Bucks Daily', url: 'https://vbucksdaily.com/' }
];

function normalizarZona(nombre) {
    const zonas = {
        stonewood: 'Stonewood',
        plankerton: 'Plankerton',
        'canny valley': 'Canny Valley',
        'twine peaks': 'Twine Peaks',
        ventures: 'Ventures',
        'hexsylvania venture zone': 'Hexsylvania Venture Zone',
        hexsylvania: 'Hexsylvania Venture Zone'
    };
    return zonas[String(nombre || '').trim().toLowerCase()] || null;
}

function extraerAlertasVBucksDaily(html) {
    const $ = cheerio.load(String(html || ''));
    const alertas = [];
    $('.mission-row').each((_, fila) => {
        const row = $(fila);
        const plMatch = limpiar(row.find('.pl').first().text()).match(/\d{1,3}/);
        const misionOriginal = limpiar(row.find('.mission-name strong').first().text());
        const ubicacion = limpiar(row.find('.mission-name small').first().text());
        const zonaMatch = ubicacion.match(/\b(Stonewood|Plankerton|Canny Valley|Twine Peaks|Ventures)\b/i);
        if (!plMatch || !zonaMatch) return;

        // Solo toma recompensas del bloque .vbucks; ignora XP, materiales y otras recompensas.
        row.find('.mission-reward.vbucks').each((__, recompensa) => {
            const texto = limpiar($(recompensa).find('strong').first().text() || $(recompensa).text());
            const cantidadMatch = texto.match(/V-?Bucks\s*(?:×|x)\s*(\d+)/i);
            if (!cantidadMatch) return;
            const cantidad = Number(cantidadMatch[1]);
            if (!Number.isFinite(cantidad) || cantidad <= 0) return;
            const zona = normalizarZona(zonaMatch[1]);
            alertas.push({
                zona,
                zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T', Ventures: 'V' })[zona],
                pl: Number(plMatch[0]),
                mision: nombreMisionSeeBot(misionOriginal),
                misionOriginal,
                cantidad,
                fuenteAlternativa: 'V-Bucks Daily'
            });
        });
    });
    return alertas;
}

async function consultarFuenteAlternativaPavos(fuente) {
    const resultado = { fuente: fuente.nombre, url: fuente.url, ok: false, alertas: [], totalPavos: 0, error: null };
    try {
        // Solo se consulta V-Bucks Daily mediante HTTP y se procesa el HTML recibido.
        const respuesta = await descargarPagina(fuente.url, 8000);
        resultado.http = respuesta.status;
        const html = String(respuesta.data || '');
        if (/just a moment|checking your browser|verify you are human/i.test(html.slice(0, 5000))) {
            throw new Error('la página respondió con una pantalla anti-bot');
        }
        if (fuente.nombre !== 'V-Bucks Daily') {
            throw new Error('fuente no admitida');
        }
        resultado.alertas = extraerAlertasVBucksDaily(html);
        if (!resultado.alertas.length) {
            throw new Error('la página respondió, pero el parser no encontró filas V-Bucks verificables en el HTML recibido');
        }
        resultado.totalPavos = resultado.alertas.reduce((s, a) => s + a.cantidad, 0);
        resultado.ok = true;
    } catch (error) {
        resultado.error = error.response?.status ? 'HTTP ' + error.response.status : error.message;
    }
    return resultado;
}

function obtenerCicloPavosMexico(fecha = new Date()) {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(fecha);
    const valor = tipo => partes.find(p => p.type === tipo)?.value;
    let dia = valor('year') + '-' + valor('month') + '-' + valor('day');
    if (Number(valor('hour')) < 18) {
        const d = new Date(dia + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        dia = d.toISOString().slice(0, 10);
    }
    const anterior = new Date(dia + 'T12:00:00Z');
    anterior.setUTCDate(anterior.getUTCDate() - 1);
    return { actual: dia, anterior: anterior.toISOString().slice(0, 10) };
}

function normalizarAlertasPavos(alertas, fuente) {
    const salida = [];
    for (const alerta of Array.isArray(alertas) ? alertas : []) {
        const cantidad = Number(alerta.cantidad ?? alerta.cantidadVbucks ?? 0);
        const pl = Number(alerta.pl);
        const zona = normalizarZona(alerta.zona || alerta.ubicacion || alerta.zone);
        if (!zona || !Number.isFinite(cantidad) || cantidad <= 0) continue;
        const misionOriginal = String(alerta.misionOriginal || alerta.mision || 'Misión de alerta').trim();
        salida.push({
            zona,
            pl: Number.isFinite(pl) && pl > 0 ? pl : null,
            mision: nombreMisionSeeBot(misionOriginal),
            misionOriginal,
            cantidad,
            fuente,
            // El comando oficial debe conservar los datos de contexto extraídos
            // de la tabla o del JSON de SeeBot, no solo la cantidad de PaVos.
            modificadores: Array.isArray(alerta.modificadores)
                ? [...new Set(alerta.modificadores.map(x => String(x || '').trim()).filter(Boolean))]
                : [],
            questReqs: String(alerta.questReqs || alerta.requisitos || '').trim(),
            requisitos: String(alerta.requisitos || alerta.questReqs || '').trim(),
            tipoRecompensa: alerta.tipoRecompensa || '',
            source: alerta.source || ''
        });
    }
    const unicas = new Map();
    for (const a of salida) {
        const clave = [a.zona, a.pl, a.mision, a.cantidad].join('|').toLowerCase();
        if (!unicas.has(clave)) unicas.set(clave, a);
    }
    return Array.from(unicas.values()).sort((a, b) =>
        String(a.zona).localeCompare(String(b.zona)) || Number(a.pl || 0) - Number(b.pl || 0)
    );
}

function firmaAlertasPavos(alertas) {
    const normalizar = valor => String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return (Array.isArray(alertas) ? alertas : [])
        .map(a => [normalizar(a.zona), Number(a.pl || 0), normalizar(a.mision), Number(a.cantidad || 0)].join('|'))
        .sort()
        .join('||');
}

async function consultarPavosSTWPlanner() {
    try {
        const { extraerAlertasAPI } = require('../webBridge');
        const resultado = await extraerAlertasAPI();
        if (!resultado || resultado.ok !== true || Number(resultado.pavos || 0) <= 0) return [];
        const doc = await Config.findOne({ clave: 'stw_pavos_scrapeados' });
        const guardadas = doc?.valor ? JSON.parse(doc.valor) : [];
        return normalizarAlertasPavos(guardadas, 'STW Planner');
    } catch (_) {
        return [];
    }
}

async function consultarPavosSeeBot() {
    try {
        const resultado = await consultarSeeBot();
        return resultado?.ok ? normalizarAlertasPavos(resultado.alertas, 'SeeBot.dev') : [];
    } catch (_) {
        return [];
    }
}

async function consultarPavosVBucksDaily() {
    try {
        const resultado = await consultarFuenteAlternativaPavos({
            nombre: 'V-Bucks Daily',
            url: 'https://vbucksdaily.com/'
        });
        return resultado?.ok ? normalizarAlertasPavos(resultado.alertas, 'V-Bucks Daily') : [];
    } catch (_) {
        return [];
    }
}

async function comandoPavosOficial(sock, chatId, msg) {
    const ciclo = obtenerCicloPavosMexico();
    const claveHoy = 'pavos_oficial_ciclo_' + ciclo.actual;
    const claveAyer = 'pavos_oficial_ciclo_' + ciclo.anterior;

    let alertasAyer = [];
    try {
        const docAyer = await Config.findOne({ clave: claveAyer });
        if (docAyer?.valor) {
            const parsed = JSON.parse(docAyer.valor);
            alertasAyer = Array.isArray(parsed) ? parsed : [];
        }
    } catch (_) {}

    const firmaAyer = firmaAlertasPavos(alertasAyer);
    const fuentes = [
        { nombre: 'STW Planner', consultar: consultarPavosSTWPlanner },
        { nombre: 'V-Bucks Daily', consultar: consultarPavosVBucksDaily },
        { nombre: 'SeeBot.dev', consultar: consultarPavosSeeBot }
    ];

    let alertasElegidas = [];
    for (const fuente of fuentes) {
        const alertas = await fuente.consultar();
        if (!alertas.length) continue;

        if (firmaAlertasPavos(alertas) === firmaAyer) continue;
        alertasElegidas = alertas;
        break;
    }

    // Si ninguna fuente detecta alertas actuales diferentes a las de ayer,
    // no reutilizar la lista anterior: la respuesta debe quedar vacía.
    const snapshot = alertasElegidas;
    try {
        await Config.findOneAndUpdate(
            { clave: claveHoy },
            { valor: JSON.stringify(snapshot) },
            { upsert: true }
        );
    } catch (_) {}

    const fechaTexto = new Date().toLocaleDateString('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const lineas = [
        '📅 _' + fechaTexto + '_',
        '',
        '🎮 *ALERTAS DE PAVOS*',
        ''
    ];

    if (!alertasElegidas.length) {
        lineas.push('😔 *No hay alertas de PaVos disponibles en este momento.*');
    } else {
        let total = 0;
        for (const alerta of alertasElegidas) {
            total += alerta.cantidad;
            lineas.push(
                '🌍 *Zona:* ' + traducirZonaSTW(alerta.zona || 'Desconocida'),
                '⚡ *PL:* ' + (alerta.pl ?? '?'),
                '🎯 *Misión:* ' + nombreMisionSeeBot(alerta.mision || alerta.misionOriginal || 'Alerta de PaVos'),
                '🪙 *PaVos:* ' + alerta.cantidad,
                ''
            );
        }
        lineas.push('💰 *Total del día:* ' + total + ' PaVos');
    }

    lineas.push('', 'Apoya a un creador: *JASC13* ❤️');
    await sock.sendMessage(chatId, { text: lineas.join('\n') }, { quoted: msg });
}

// Se conserva el alias antiguo, pero ambos comandos usan el mismo sistema oficial.
async function comandoRPavos(sock, chatId, msg) {
    return comandoPavosOficial(sock, chatId, msg);
}
module.exports = {
    consultarSeeBot,
    extraerDatosSeeBot,
    diagnosticarMenuFortnite,
    comandoRPavos,
    comandoPavosOficial
};

const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('../database/modelos');
const { traducirNombreMisionSTW, traducirZonaSTW, traducirModificadorSTW } = require('../webBridge');

const URL_FORTNITEDB = 'https://v2.fortnitedb.com/index.php';
const URL_FORTNITEDB_PRINCIPAL = 'https://fortnitedb.com/index.php';
const URL_FORTNITEDB_RESPALDO = 'https://cdn.fortnitedb.com/index.php';
const URL_FORTNITEDB_ALTERNATIVA = 'https://fortnitedb.com/';
const URL_FORTNITEDB_STATUS = 'https://status.fortnitedb.com/index.php';
const URL_FORTNITEDB_DEV = 'https://dev.fortnitedb.com/index.php';
const URL_FORTNITEDB_STATUS_HOME = 'https://status.fortnitedb.com/index.php';
const URL_SEEBOT = 'https://seebot.dev/missions.php';

// Circuit breaker: no repetir hosts que ya devolvieron 403 ni volver a lanzar un navegador que expiró.
// Se conserva durante la vida del proceso para evitar gastar tiempo en errores conocidos.
const hostsFortniteDBBloqueados = new Set();
let navegadorFortniteDBDeshabilitado = false;

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

function nombreMisionFortniteDB(icono, alt = '') {
    const referencia = (String(icono || '') + ' ' + String(alt || '')).toLowerCase();
    if (referencia.includes('icon-mission-data') || referencia.includes('retrieve-the-data')) return 'Recupera los datos';
    if (referencia.includes('t-icon-ride') || referencia.includes('ride-the-lightning')) return 'Viaja en el rayo';
    if (referencia.includes('repair-the-shelter')) return 'Repara el refugio';
    if (referencia.includes('fight-the-storm')) return 'Lucha contra la tormenta';
    if (referencia.includes('evacuate-the-shelter')) return 'Evacúa el refugio';
    if (referencia.includes('deliver-the-bomb')) return 'Entrega la bomba';
    if (referencia.includes('rescue-the-survivors')) return 'Rescata a los supervivientes';
    if (referencia.includes('build-the-radar')) return 'Construye el radar';
    return 'Misión de alerta';
}

function nombreMisionSeeBot(nombre) {
    return traducirNombreMisionSTW(nombre) || nombre || 'Misión de alerta';
}

async function reportar(progreso, texto) {
    if (typeof progreso !== 'function') return;
    try {
        await progreso(texto);
    } catch (e) {
        console.error('No se pudo enviar una actualización del diagnóstico:', e.message);
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

function localizarTablaFortniteDB($) {
    const encabezado = $('h1, h2, h3, h4, h5, h6, .title, .block-title')
        .filter((_, el) => limpiar($(el).text()).toLowerCase().includes('v-bucks missions'))
        .first();

    if (!encabezado.length) return $();
    const bloque = encabezado.closest('.new_block_block');
    if (bloque.length) {
        const tabla = bloque.find('table.summary-honorable, table.summary-wrapper, table').first();
        if (tabla.length) return tabla;
    }

    let contenedor = encabezado.parent();
    for (let i = 0; i < 6 && contenedor.length; i++, contenedor = contenedor.parent()) {
        const tabla = contenedor.find('table.summary-honorable, table.summary-wrapper').first();
        if (tabla.length) return tabla;
    }
    return $();
}

async function consultarFortniteDBConNavegador(progreso) {
    // Se ejecuta únicamente bajo demanda, después de que Axios falle; no afecta al arranque del bot.
    // Usa un navegador normal, sin técnicas para ocultar la automatización ni evadir desafíos anti-bot.
    let browser;
    try {
        await reportar(progreso, '🌐 FortniteDB: los accesos HTTP directos fallaron; probando una carga normal con Puppeteer en la página pública.');
        const puppeteer = require('puppeteer');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(8000);
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        const url = 'https://dev.fortnitedb.com/';
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
        const status = response ? response.status() : 0;
        const html = await page.content();
        const titulo = await page.title();
        const texto = await page.locator('body').innerText().catch(() => '');
        if (/just a moment|checking your browser|verify you are human|attention required/i.test(titulo + ' ' + texto.slice(0, 1200))) {
            throw new Error('El navegador también recibió una pantalla de protección anti-bot de Cloudflare; no se intentará evadirla.');
        }
        if (status >= 400) throw new Error('La navegación normal respondió HTTP ' + status + '.');
        if (!/v-bucks missions/i.test(texto) && !/v-bucks missions/i.test(html)) {
            throw new Error('La página cargó, pero no se encontró la sección pública “V-Bucks Missions”. Título=' + titulo);
        }
        return {
            status: status || 200,
            headers: { 'content-type': 'text/html; charset=UTF-8' },
            data: html,
            request: { res: { responseUrl: page.url() } }
        };
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

async function consultarFortniteDB(progreso) {
    const resultado = { fuente: 'FortniteDB', url: URL_FORTNITEDB, alertas: [], error: null, etapas: [] };
    const inicio = Date.now();
    const paso = async (texto) => {
        const marcado = '[' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s] ' + texto;
        resultado.etapas.push(marcado);
        await reportar(progreso, marcado);
    };

    try {
        await paso('🔬 *FortniteDB ETAPA 1 — CONEXIÓN:* probando la página principal y la página dedicada de misiones de PaVos con timeout HTTP de 5 s por intento.');
        let respuesta;
        const intentos = [
            // El host v2 está sirviendo actualmente la página de misiones y se prueba primero.
            { url: URL_FORTNITEDB, nombre: 'host v2 (principal)' },
            { url: URL_FORTNITEDB_PRINCIPAL, nombre: 'host principal alternativo' },
            { url: URL_FORTNITEDB_DEV, nombre: 'host dev' },
            { url: URL_FORTNITEDB_RESPALDO, nombre: 'host CDN alternativo' },
            { url: URL_FORTNITEDB_STATUS_HOME, nombre: 'host status alternativo' }
        ];
        const fallos = [];
        for (const intento of intentos) {
            const host = new URL(intento.url).hostname;
            if (hostsFortniteDBBloqueados.has(host)) {
                fallos.push(intento.nombre + ': omitido; ya devolvió HTTP 403 en este proceso');
                await paso('⏭️ FortniteDB: se omite ' + intento.nombre + '; ya falló con HTTP 403 y no se repetirá en este proceso.');
                continue;
            }
            try {
                await paso('🔌 FortniteDB: probando ' + intento.nombre + ' (' + intento.url + ').');
                respuesta = await descargarPagina(intento.url, 5000);
                resultado.url = intento.url;
                break;
            } catch (errorIntento) {
                const detalle = detalleErrorHTTP(errorIntento);
                if (errorIntento?.response?.status === 403) hostsFortniteDBBloqueados.add(host);
                fallos.push(intento.nombre + ': ' + detalle);
                await paso('⚠️ FortniteDB: falló ' + intento.nombre + ' — ' + detalle + '.');
            }
        }
        if (!respuesta && !navegadorFortniteDBDeshabilitado) {
            await paso('🧭 FortniteDB: los intentos HTTP directos fallaron; iniciando comprobación de navegador normal como última alternativa.');
            try {
                respuesta = await consultarFortniteDBConNavegador(progreso);
                resultado.url = 'https://dev.fortnitedb.com/';
                await paso('✅ FortniteDB: el navegador pudo cargar la página pública; ahora se intentará extraer la tabla con el mismo parser.');
            } catch (errorNavegador) {
                navegadorFortniteDBDeshabilitado = true;
                fallos.push('navegador Puppeteer: ' + (errorNavegador.message || String(errorNavegador)));
                await paso('⚠️ FortniteDB: la alternativa de navegador tampoco pudo obtener datos — ' + (errorNavegador.message || String(errorNavegador)) + '. Queda deshabilitada para evitar repetir el mismo timeout en este proceso.');
            }
        }
        if (!respuesta && navegadorFortniteDBDeshabilitado) {
            fallos.push('navegador Puppeteer: omitido; ya expiró en un intento anterior de este proceso');
        }
        if (!respuesta) {
            throw new Error('No se pudo leer FortniteDB por HTTP ni mediante una carga normal de navegador. Detalles: ' + fallos.join(' | ') +
                '. Si todos los hosts devuelven 403 y el navegador muestra Cloudflare, se requiere una vía de acceso autorizada o una fuente alternativa; no se evadirá el desafío anti-bot.');
        }
        resultado.http = respuesta.status;
        resultado.contentType = respuesta.headers?.['content-type'] || 'desconocido';
        resultado.responseUrl = respuesta.request?.res?.responseUrl || resultado.url;
        await paso('📥 *FortniteDB ETAPA 2 — RESPUESTA:* HTTP ' + respuesta.status + '; URL final ' + resultado.responseUrl + '; content-type ' + resultado.contentType + '; ' + String(respuesta.data || '').length + ' caracteres.');

        const $ = cheerio.load(respuesta.data);
        const titulo = limpiar($('title').first().text()) || '(sin title)';
        await paso('🧩 *FortniteDB ETAPA 3 — HTML:* HTML parseado con Cheerio; título detectado: ' + titulo + '; tablas=' + $('table').length + '; filas totales=' + $('tr').length + '.');
        await paso('🔎 *FortniteDB ETAPA 4 — SELECTOR:* buscando encabezado “V-Bucks Missions” y tabla asociada.');
        const tabla = localizarTablaFortniteDB($);
        if (!tabla.length) throw new Error('ETAPA 4/7 SELECTOR: la página respondió, pero no encontré la tabla “V-Bucks Missions”. Título=' + titulo + '; tablas=' + $('table').length + '; HTML inicial=' + limpiar(String(respuesta.data || '').replace(/<[^>]*>/g, ' ')).slice(0, 220));

        const filas = tabla.find('tr');
        await paso('📋 *FortniteDB ETAPA 5 — FILAS:* selector correcto; filas en tabla=' + filas.length + '.');
        filas.each((_, fila) => {
            const celdas = $(fila).find('td');
            if (celdas.length < 4) return;
            const zonaCodigo = limpiar($(celdas[0]).text()).toUpperCase();
            const imagen = $(celdas[1]).find('img').first();
            const poderTexto = limpiar($(celdas[2]).text());
            const recompensa = limpiar($(celdas[3]).text());
            const matchPavos = recompensa.match(/(\d+)\s*x?\s*(?:V-Bucks|V\s*Bucks)/i);
            if (!matchPavos || !ZONAS[zonaCodigo]) return;
            const cantidad = Number(matchPavos[1]);
            if (!Number.isFinite(cantidad) || cantidad <= 0) return;
            const poderMatch = poderTexto.match(/\d+/);
            resultado.alertas.push({
                zona: ZONAS[zonaCodigo],
                zonaCodigo,
                pl: poderMatch ? Number(poderMatch[0]) : null,
                mision: 'Alerta de PaVos', // FortniteDB muestra zona, PL y recompensa en esta tabla; no expone aquí el nombre de la misión.
                cantidad
            });
        });

        await paso('🧮 *FortniteDB ETAPA 6 — EXTRACCIÓN:* filas revisadas=' + filas.length + '; alertas de PaVos válidas=' + resultado.alertas.length + '.');
        if (resultado.alertas.length === 0) {
            const muestra = filas.slice(0, 4).map((_, fila) => limpiar($(fila).text())).get().join(' || ').slice(0, 260);
            throw new Error('ETAPA 6/7 EXTRACCIÓN: tabla encontrada, pero 0 filas válidas. Se esperaba zona (S/P/C/T/V), PL y recompensa V-Bucks. Muestra de filas=' + (muestra || '(vacías)'));
        }
        resultado.totalPavos = resultado.alertas.reduce((suma, alerta) => suma + alerta.cantidad, 0);
        resultado.ok = true;
        await paso('✅ *FortniteDB ETAPA 7 — VALIDACIÓN FINAL:* extracción completa; ' + resultado.alertas.length + ' alertas, total ' + resultado.totalPavos + ' PaVos; duración ' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s.');
    } catch (error) {
        resultado.error = error.message || String(error);
        resultado.ok = false;
        resultado.etapaFallo = resultado.etapas.length ? resultado.etapas[resultado.etapas.length - 1] : 'inicio';
        await paso('❌ *FORTNITEDB FALLÓ:* último punto registrado=' + resultado.etapaFallo + ' | causa=' + resultado.error + ' | duración=' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s.');
    }
    return resultado;
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
            await paso('↪️ SeeBot: la tabla #miniRwdTbl no produjo alertas; se intenta la ruta B, el arreglo JSON makeHtml(...).');
            const misiones = extraerDatosSeeBot(html);
            resultado.rutaExtraccion = 'JSON makeHtml';
            await paso('📋 *SeeBot ETAPA 5 — DATOS JSON:* lista válida; misiones leídas=' + misiones.length + '; filtrando recompensas de PaVos.');
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
                    zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T', Ventures: 'V' })[zona],
                    pl: Number(mision.powerLevel) || null,
                    mision: nombreMisionSeeBot(mision.name),
                    cantidad,
                    tipoRecompensa: 'V-Bucks'
                });
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
        ventures: 'Ventures'
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

function extraerAlertasPennyDB(html) {
    const $ = cheerio.load(String(html || ''));
    const alertas = [];
    const vistos = new Set();
    let filasRecompensa = 0;
    let filasConCantidad = 0;
    let filasSinContexto = 0;

    // Primero, leer la tarjeta compacta de la misión: reúne recompensa, zona, PL y título.
    // Es la estructura .mission-brief que aparece en /stw-missions.
    $('.mission-brief').each((_, briefEl) => {
        const brief = $(briefEl);
        const bay = brief.find('.mission-bay').first();
        const recompensa = limpiar(bay.find('[title]').map((__, n) => $(n).attr('title') || '').get().join(' '));
        if (!/v-?bucks\s+voucher|v-?bucks/i.test(recompensa)) return;

        const cantidadTexto = limpiar(bay.find('.mission-payload-figure').first().text() || bay.find('.mission-figure').first().text());
        const cantidadMatch = cantidadTexto.match(/\b(\d{1,4})\b/);
        const cantidad = cantidadMatch ? Number(cantidadMatch[1]) : NaN;
        const zonaTexto = limpiar(brief.find('[aria-label]').map((__, n) => $(n).attr('aria-label') || '').get().join(' '));
        const zonaMatch = zonaTexto.match(/\b(Stonewood|Plankerton|Canny Valley|Twine Peaks|Ventures)\b/i);
        const zona = zonaMatch ? normalizarZona(zonaMatch[1]) : null;
        const plTexto = limpiar(brief.find('.mission-power-figure').first().text() || brief.find('.mission-power').text());
        const plMatch = plTexto.match(/\b(\d{1,3})\b/);
        const misionOriginal = limpiar(brief.find('.mission-job [title]').first().attr('title') ||
            brief.find('.mission-job').first().text()).replace(/\s+/g, ' ');

        if (!zona || !plMatch || !Number.isFinite(cantidad) || cantidad <= 0) {
            filasRecompensa++;
            if (Number.isFinite(cantidad) && cantidad > 0) filasConCantidad++;
            filasSinContexto++;
            return;
        }
        filasRecompensa++;
        filasConCantidad++;
        const clave = [zona, Number(plMatch[1]), cantidad, misionOriginal || 'Misión de alerta'].join('|');
        if (vistos.has(clave)) return;
        vistos.add(clave);
        let detalle = $();
        let ancestro = brief.parent();
        for (let nivel = 0; nivel < 8 && ancestro.length; nivel++, ancestro = ancestro.parent()) {
            detalle = ancestro.find('.mission-detail').first();
            if (detalle.length || ancestro.is('body') || ancestro.is('html')) break;
        }
        const otrasRecompensas = [];
        detalle.find('section').each((__, section) => {
            const seccion = $(section);
            if (!/^alert rewards$/i.test(limpiar(seccion.find('h3').first().text()))) return;
            seccion.find('li').each((___, li) => {
                const fila = $(li);
                const nombre = limpiar(fila.find('[title]').first().attr('title') || fila.text());
                const valor = limpiar(fila.find('.mission-figure').first().text());
                if (nombre && !/v-?bucks voucher/i.test(nombre)) otrasRecompensas.push(nombre + (valor ? ' × ' + valor : ''));
            });
        });
        const modificadores = [];
        detalle.find('section').each((__, section) => {
            const seccion = $(section);
            if (!/^modifiers$/i.test(limpiar(seccion.find('h3').first().text()))) return;
            seccion.find('li').each((___, li) => {
                const fila = $(li);
                const img = fila.find('img').first();
                const nombre = limpiar(img.attr('title') || img.attr('alt') || fila.text());
                if (nombre) modificadores.push(nombre);
            });
        });
        alertas.push({
            zona,
            zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T', Ventures: 'V' })[zona],
            pl: Number(plMatch[1]),
            mision: nombreMisionSeeBot(misionOriginal || 'Misión de alerta'),
            misionOriginal: misionOriginal || 'Misión de alerta',
            cantidad,
            recompensaOriginal: recompensa,
            otrasRecompensas,
            modificadores,
            fuenteAlternativa: 'PennyDB'
        });
    });

    // La página /stw-missions puede cambiar encabezados y clases entre versiones.
    // Buscar la recompensa por texto/atributos en todo el HTML y subir al contenedor de misión.
    const candidatos = new Set();
    $('[title], img[alt], li, .mission-reward').each((_, el) => {
        const nodo = $(el);
        const texto = limpiar([
            nodo.attr('title'), nodo.attr('alt'), nodo.text(),
            nodo.find('[title]').map((__, hijo) => $(hijo).attr('title') || '').get().join(' '),
            nodo.find('img[alt]').map((__, hijo) => $(hijo).attr('alt') || '').get().join(' ')
        ].filter(Boolean).join(' '));
        if (/v-?bucks(?:\s+voucher)?|voucher/i.test(texto)) candidatos.add(el);
    });

    candidatos.forEach((el) => {
        const item = $(el);
        const itemTexto = limpiar([
            item.attr('title'), item.attr('alt'), item.text(),
            item.find('[title]').map((__, hijo) => $(hijo).attr('title') || '').get().join(' '),
            item.find('img[alt]').map((__, hijo) => $(hijo).attr('alt') || '').get().join(' ')
        ].filter(Boolean).join(' '));
        if (!/v-?bucks|voucher/i.test(itemTexto)) return;

        const fila = item.closest('li').length ? item.closest('li') :
            (item.closest('.mission-reward').length ? item.closest('.mission-reward') : item);
        const nombreRecompensa = itemTexto;
        const cantidadTexto = limpiar(
            fila.find('.mission-figure').first().text() ||
            fila.find('[class*="figure"]').first().text() ||
            fila.text() || itemTexto
        );
        const cantidadMatch = cantidadTexto.match(/(?:×|x)\s*(\d{1,4})|\b(\d{1,4})\b/);
        const cantidad = cantidadMatch ? Number(cantidadMatch[1] || cantidadMatch[2]) : NaN;
        if (!Number.isFinite(cantidad) || cantidad <= 0) return;
        filasRecompensa++;
        filasConCantidad++;

        let zona = null;
        let pl = null;
        let original = null;
        let contenedor = fila;
        for (let nivel = 0; nivel < 14 && contenedor.length; nivel++, contenedor = contenedor.parent()) {
            const texto = limpiar(contenedor.text());
            const attrs = [
                contenedor.attr('data-zone'), contenedor.attr('data-region'),
                contenedor.attr('data-power-level'), contenedor.attr('data-pl'),
                contenedor.attr('aria-label'), contenedor.attr('title'), contenedor.attr('class'),
                contenedor.find('[title]').map((__, hijo) => $(hijo).attr('title') || '').get().join(' ')
            ].filter(Boolean).join(' ') + ' ' + texto;
            const zonaMatch = attrs.match(/\b(Stonewood|Plankerton|Canny Valley|Twine Peaks|Ventures)\b/i);
            if (!zona && zonaMatch) zona = normalizarZona(zonaMatch[1]);

            const plAttr = contenedor.attr('data-power-level') || contenedor.attr('data-pl');
            const plMatch = String(plAttr || '').match(/\d{1,3}/) ||
                attrs.match(/\b(?:PL|Power Level|PowerLevel)\s*[:#]?\s*(\d{1,3})\b/i) ||
                attrs.match(/\b(\d{1,3})\s*(?:PL|Power Level|PowerLevel)\b/i);
            if (pl === null && plMatch) {
                const n = Number(plMatch[1] || plMatch[0]);
                if (n >= 1 && n <= 999) pl = n;
            }
            if (!original) {
                const tituloMision = contenedor.find('h1, h2, h3, h4, button, [data-mission-name], .mission-name, .mission-title, [class*="mission-name"]').filter((__, nodo) => {
                    const t = limpiar($(nodo).text());
                    return t && t.length < 100 && !/alert rewards|base rewards|v-?bucks|voucher/i.test(t) &&
                        /(Ride the Lightning|Retrieve the Data|Repair the Shelter|Fight Category|Fight the Storm|Evacuate the Shelter|Deliver the Bomb|Rescue the Survivors|Destroy the Encampments|Build the Radar|Eliminate and Collect|Launch the Rocket|Resupply|Refuel Homebase)/i.test(t);
                }).first();
                if (tituloMision.length) original = limpiar(tituloMision.attr('data-mission-name') || tituloMision.text());
            }
            if (zona && pl !== null && original) break;
            if (contenedor.is('body') || contenedor.is('html')) break;
        }

        if (!zona || pl === null) {
            filasSinContexto++;
            return;
        }
        if (!original) original = 'Misión de alerta';
        const clave = [zona, pl, cantidad, original].join('|');
        if (vistos.has(clave)) return;
        vistos.add(clave);
        alertas.push({
            zona,
            zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T', Ventures: 'V' })[zona],
            pl,
            mision: nombreMisionSeeBot(original),
            misionOriginal: original,
            cantidad,
            recompensaOriginal: nombreRecompensa,
            fuenteAlternativa: 'PennyDB'
        });
    });
    alertas.diagnosticoPennyDB = { filasRecompensa, filasConCantidad, filasSinContexto };
    return alertas;
}
async function consultarPennyDBConNavegador() {
    // PennyDB puede entregar por HTTP el resumen estático, mientras que las tarjetas
    // de misiones y sus detalles aparecen después de ejecutar JavaScript.
    // Se usa una carga normal de navegador; no se intenta evadir protección anti-bot.
    let browser;
    try {
        const puppeteer = require('puppeteer');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(15000);
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        const response = await page.goto('https://pennydb.net/stw-missions', {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });
        const status = response ? response.status() : 0;
        await page.waitForFunction(() => {
            const html = document.documentElement?.innerHTML || '';
            return /v-bucks\s+voucher/i.test(html) ||
                Boolean(document.querySelector('.mission-brief .mission-bay'));
        }, { timeout: 12000 }).catch(() => {});
        const html = await page.content();
        const titulo = await page.title();
        const texto = await page.locator('body').innerText().catch(() => '');
        if (/just a moment|checking your browser|verify you are human|attention required/i.test(titulo + ' ' + texto.slice(0, 1200))) {
            throw new Error('PennyDB entregó una pantalla de protección anti-bot en la carga del navegador.');
        }
        if (status >= 400) throw new Error('PennyDB respondió HTTP ' + status + ' en navegador.');
        return { html, status: status || 200, url: page.url(), titulo };
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

function extraerAlertasFuenteAlternativa(html, nombreFuente) {
    if (nombreFuente === 'V-Bucks Daily') return extraerAlertasVBucksDaily(html);
    if (nombreFuente === 'PennyDB') return extraerAlertasPennyDB(html);
    return [];
}
async function consultarFuenteAlternativaPavos(fuente) {
    const resultado = { fuente: fuente.nombre, url: fuente.url, ok: false, alertas: [], totalPavos: 0, error: null };
    try {
        const respuesta = await descargarPagina(fuente.url, fuente.nombre === 'V-Bucks Daily' ? 25000 : 15000);
        resultado.http = respuesta.status;
        let html = String(respuesta.data || '');
        let pennyDBFallbackError = null;
        let pennyDBPaginaRenderizada = false;
        if (/just a moment|checking your browser|verify you are human/i.test(html.slice(0, 5000))) {
            throw new Error('la página respondió con una pantalla anti-bot');
        }
        if (fuente.nombre === 'PennyDB' && !/v-?bucks\s+voucher/i.test(html)) {
            try {
                const renderizada = await consultarPennyDBConNavegador();
                // Solo reemplazar la respuesta HTTP si la página renderizada aporta
                // la estructura de alertas; así no se confunde un HTML incompleto con cero.
                if (/v-?bucks\s+voucher/i.test(renderizada.html)) {
                    html = renderizada.html;
                    pennyDBPaginaRenderizada = true;
                    resultado.httpNavegador = renderizada.status;
                    resultado.urlNavegador = renderizada.url;
                } else {
                    pennyDBFallbackError = 'El navegador abrió PennyDB, pero tras esperar no apareció V-Bucks Voucher ni una tarjeta .mission-brief .mission-bay.';
                }
            } catch (errorNavegador) {
                pennyDBFallbackError = errorNavegador.message || String(errorNavegador);
            }
        }
        if (fuente.nombre === 'PennyDB') {
            const $debug = cheerio.load(html);
            const textoPlano = limpiar($debug('body').text() || html.replace(/<[^>]*>/g, ' '));
            const voucherIndex = textoPlano.toLowerCase().indexOf('v-bucks voucher');
            const alertIndex = textoPlano.toLowerCase().indexOf('alert rewards');
            const index = voucherIndex >= 0 ? voucherIndex : alertIndex;
            resultado.diagnosticoHTML = {
                titulo: limpiar($debug('title').first().text()) || '(sin title)',
                urlFinal: respuesta.request?.res?.responseUrl || fuente.url,
                caracteresHTML: html.length,
                encabezadosAlertRewards: $debug('h3.mission-label').filter((_, el) => /alert rewards/i.test(limpiar($debug(el).text()))).length,
                mencionaVoucher: /v-bucks voucher/i.test(html),
                mencionaAlertRewards: /alert rewards/i.test(html),
                paginaRenderizada: pennyDBPaginaRenderizada,
                fallbackNavegador: pennyDBFallbackError,
                fragmento: index >= 0 ? textoPlano.slice(Math.max(0, index - 100), index + 260) : textoPlano.slice(0, 260)
            };
        }
        resultado.alertas = extraerAlertasFuenteAlternativa(html, fuente.nombre);
        if (fuente.nombre === 'PennyDB' && !resultado.alertas.length) {
            const $penny = cheerio.load(html);
            const textoPenny = limpiar($penny('body').text() || html.replace(/<[^>]*>/g, ' '));
            // El contador está en tarjetas separadas; limitar la búsqueda al texto entre
            // "V-Bucks in alerts" y el siguiente indicador evita confundir otros ceros.
            const bloqueContador = textoPenny.match(/V-?Bucks\s+in\s+alerts([\s\S]{0,80}?)(?=Mission alerts|Missions on the board|New board in|$)/i);
            const contadorVBucks = bloqueContador ? limpiar(bloqueContador[1]) : '(contador no localizado)';
            const ceroVBucks = Boolean(bloqueContador && /\b0\b/.test(bloqueContador[1]));
            const tieneVoucher = /v-?bucks\s+voucher/i.test(html);
            if (ceroVBucks && !tieneVoucher && pennyDBPaginaRenderizada) {
                resultado.ok = true;
                resultado.totalPavos = 0;
                resultado.alertas.diagnosticoPennyDB = resultado.alertas.diagnosticoPennyDB || {
                    filasRecompensa: 0, filasConCantidad: 0, filasSinContexto: 0
                };
                resultado.diagnosticoHTML = {
                    ...(resultado.diagnosticoHTML || {}),
                    contadorVBucks,
                    ceroVBucksDetectado: true
                };
                return resultado;
            }
            resultado.diagnosticoHTML = {
                ...(resultado.diagnosticoHTML || {}),
                contadorVBucks,
                ceroVBucksDetectado: ceroVBucks
            };
        }
        if (!resultado.alertas.length) {
            const d = resultado.alertas.diagnosticoPennyDB;
            if (fuente.nombre === 'PennyDB' && d) {
                const h = resultado.diagnosticoHTML || {};
                const resumen = ' | HTTP=' + resultado.http + ' | URL=' + (h.urlFinal || fuente.url) + ' | título=' + (h.titulo || '(desconocido)') + ' | HTML=' + (h.caracteresHTML || html.length) + ' caracteres | encabezados Alert rewards=' + (h.encabezadosAlertRewards ?? '?') + ' | contiene Voucher=' + (h.mencionaVoucher ? 'sí' : 'no') + ' | contiene Alert rewards=' + (h.mencionaAlertRewards ? 'sí' : 'no') + ' | fragmento=' + (h.fragmento || '(vacío)');
                if (!d.filasRecompensa) throw new Error('PennyDB: el selector no encontró filas V-Bucks dentro de Alert rewards.' + resumen);
                if (!d.filasConCantidad) throw new Error('PennyDB: encontró ' + d.filasRecompensa + ' fila(s) Voucher, pero no leyó una cantidad válida de .mission-figure.' + resumen);
                throw new Error('PennyDB: encontró ' + d.filasConCantidad + ' recompensa(s) con cantidad, pero no pudo asociar zona y PL (' + d.filasSinContexto + ' fila(s) sin contexto).' + resumen);
            }
            if (fuente.nombre === 'PennyDB' && !pennyDBPaginaRenderizada && !tieneVoucher) {
                throw new Error('PennyDB: el HTML HTTP no contiene las tarjetas de alertas (Voucher ausente); no se puede afirmar que haya 0 PaVos. ' +
                    (pennyDBFallbackError ? 'Fallback de navegador: ' + pennyDBFallbackError : 'El navegador no confirmó la carga de las tarjetas.'));
            }
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
            fuente
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
        { nombre: 'SeeBot.dev', consultar: consultarPavosSeeBot },
        { nombre: 'V-Bucks Daily', consultar: consultarPavosVBucksDaily }
    ];

    let alertasElegidas = [];
    let primeraAlertaVista = [];
    for (const fuente of fuentes) {
        const alertas = await fuente.consultar();
        if (!alertas.length) continue;

        // Conservamos la primera respuesta real para recordar qué mostraba la fuente
        // aunque las tres fuentes estén repitiendo las alertas del ciclo anterior.
        if (!primeraAlertaVista.length) primeraAlertaVista = alertas;

        if (firmaAlertasPavos(alertas) === firmaAyer) continue;
        alertasElegidas = alertas;
        break;
    }

    // Si las tres fuentes conservan la misma lista que ayer, igualmente
    // se muestra la lista válida al usuario: repetir la alerta del día es mejor
    // que responder falsamente que no existen PaVos.
    if (!alertasElegidas.length && primeraAlertaVista.length) {
        alertasElegidas = primeraAlertaVista;
    }
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
        lineas.push('😔 *No hubo PaVos en este raspado.* 💔');
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

    lineas.push('', 'Support-a-Creator: *JASC13* ❤️');
    await sock.sendMessage(chatId, { text: lineas.join('\n') }, { quoted: msg });
}

// Se conserva el alias antiguo, pero ambos comandos usan el mismo sistema oficial.
async function comandoRPavos(sock, chatId, msg) {
    return comandoPavosOficial(sock, chatId, msg);
}
module.exports = {
    consultarFortniteDB,
    consultarSeeBot,
    extraerDatosSeeBot,
    diagnosticarMenuFortnite,
    obtenerAlertasFortniteDB: async () => consultarFortniteDB(),
    comandoRPavos,
    comandoPavosOficial
};

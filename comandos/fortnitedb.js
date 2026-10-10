const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('../database/modelos');

const URL_FORTNITEDB = 'https://fortnitedb.com/index.php';
const URL_FORTNITEDB_RESPALDO = 'https://cdn.fortnitedb.com/index.php';
const URL_FORTNITEDB_ALTERNATIVA = 'https://fortnitedb.com/';
const URL_FORTNITEDB_STATUS = 'https://status.fortnitedb.com/index.php';
const URL_FORTNITEDB_DEV = 'https://dev.fortnitedb.com/index.php';
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
    const nombres = {
        'retrieve the data': 'Recupera los datos',
        'ride the lightning': 'Viaja en el rayo',
        'repair the shelter': 'Repara el refugio',
        'fight the storm': 'Lucha contra la tormenta',
        'evacuate the shelter': 'Evacúa el refugio',
        'deliver the bomb': 'Entrega la bomba',
        'rescue the survivors': 'Rescata a los supervivientes',
        'build the radar': 'Construye el radar',
        'eliminate and collect': 'Elimina y recoge',
        'destroy the encampments': 'Destruye los campamentos'
    };
    return nombres[String(nombre || '').trim().toLowerCase()] || nombre || 'Misión de alerta';
}

async function reportar(progreso, texto) {
    if (typeof progreso !== 'function') return;
    try {
        await progreso(texto);
    } catch (e) {
        console.error('No se pudo enviar una actualización del diagnóstico:', e.message);
    }
}

async function descargarPagina(url) {
    const respuesta = await axios.get(url, {
        timeout: 25000,
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

async function consultarFortniteDB(progreso) {
    const resultado = { fuente: 'FortniteDB', url: URL_FORTNITEDB, alertas: [], error: null, etapas: [] };
    const inicio = Date.now();
    const paso = async (texto) => {
        const marcado = '[' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s] ' + texto;
        resultado.etapas.push(marcado);
        await reportar(progreso, marcado);
    };

    try {
        await paso('🔬 *FortniteDB ETAPA 1 — CONEXIÓN:* preparando solicitud HTTP con timeout de 25 s, redirecciones máximas 5 y User-Agent de navegador.');
        let respuesta;
        const intentos = [
            { url: URL_FORTNITEDB, nombre: 'página principal' },
            { url: URL_FORTNITEDB_RESPALDO, nombre: 'CDN oficial' },
            { url: URL_FORTNITEDB_STATUS, nombre: 'host status' },
            { url: URL_FORTNITEDB_DEV, nombre: 'host dev' },
            { url: URL_FORTNITEDB_ALTERNATIVA, nombre: 'ruta raíz' }
        ];
        const fallos = [];
        for (const intento of intentos) {
            try {
                await paso('🔌 FortniteDB: probando ' + intento.nombre + ' (' + intento.url + ').');
                respuesta = await descargarPagina(intento.url);
                resultado.url = intento.url;
                break;
            } catch (errorIntento) {
                const detalle = detalleErrorHTTP(errorIntento);
                fallos.push(intento.nombre + ': ' + detalle);
                await paso('⚠️ FortniteDB: falló ' + intento.nombre + ' — ' + detalle + '.');
            }
        }
        if (!respuesta) {
            throw new Error('No se pudo descargar ninguna ruta de FortniteDB. Detalles: ' + fallos.join(' | ') +
                '. Un HTTP 403 significa que el servidor/CDN bloqueó la petición; cambiar el parser no lo soluciona.');
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
        const respuesta = await descargarPagina(URL_SEEBOT);
        resultado.http = respuesta.status;
        resultado.contentType = respuesta.headers?.['content-type'] || 'desconocido';
        resultado.responseUrl = respuesta.request?.res?.responseUrl || URL_SEEBOT;
        const html = String(respuesta.data || '');
        await paso('📥 *SeeBot ETAPA 2 — RESPUESTA:* HTTP ' + respuesta.status + '; URL final=' + resultado.responseUrl + '; content-type=' + resultado.contentType + '; bytes/caracteres=' + html.length + '.');

        const $see = cheerio.load(html);
        await paso('🧩 *SeeBot ETAPA 3 — HTML:* título=' + (limpiar($see('title').first().text()) || '(sin title)') + '; scripts=' + $see('script').length + '; contiene makeHtml=' + /makeHtml\s*\(/i.test(html) + '; señales anti-bot=' + /cloudflare|checking your browser|just a moment/i.test(html) + '.');
        await paso('🔎 *SeeBot ETAPA 4 — PARSER:* localizando y validando el arreglo JSON de makeHtml(...).');
        const misiones = extraerDatosSeeBot(html);
        await paso('📋 *SeeBot ETAPA 5 — DATOS:* JSON válido; misiones leídas=' + misiones.length + '; filtrando recompensas de PaVos.');

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
                cantidad
            });
        }

        await paso('🧮 *SeeBot ETAPA 6 — FILTRO:* misiones procesadas=' + misiones.length + '; zonas válidas=' + misiones.filter(m => ['Stonewood', 'Plankerton', 'Canny Valley', 'Twine Peaks'].includes(String(m.zone || '').trim())).length + '; alertas con PaVos=' + resultado.alertas.length + '.');
        if (resultado.alertas.length === 0) {
            const muestra = misiones.slice(0, 3).map(m => 'zona=' + (m.zone || '?') + ', PL=' + (m.powerLevel ?? '?') + ', recompensas=' + (Array.isArray(m.alertRewards) ? m.alertRewards.map(r => r.itemType + ':' + r.quantity).join(',') : 'sin alertRewards')).join(' || ');
            throw new Error('ETAPA 6/7 FILTRO: JSON leído (' + misiones.length + ' misiones), pero 0 alertas con V-Bucks en alertRewards. Muestra=' + (muestra || '(lista vacía)'));
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
    let marcaAnterior = null;
    try {
        const anterior = await Config.findOne({ clave: 'stw_ultima_actualizacion' }).lean();
        if (anterior?.valor) { try { marcaAnterior = JSON.parse(anterior.valor).actualizadoEn || null; } catch (e) {} }
        const { extraerAlertasAPI } = require('../webBridge');
        await paso('🌐 STW Planner: iniciando una extracción real de las páginas de alertas y misiones de PaVos.');
        await extraerAlertasAPI();
        const actual = await Config.findOne({ clave: 'stw_ultima_actualizacion' }).lean();
        let marcaNueva = null;
        if (actual?.valor) { try { marcaNueva = JSON.parse(actual.valor).actualizadoEn || null; } catch (e) {} }
        if (marcaNueva && marcaNueva !== marcaAnterior) {
            await paso('✅ STW Planner: se guardó una actualización nueva (' + marcaNueva + ').');
        } else {
            resultado.ok = false;
            resultado.errores.push('STW Planner: no se confirmó una actualización nueva; el raspado pudo fallar o devolver 0 misiones.');
            await paso('❌ STW Planner: no se confirmó una actualización nueva; revisar logs del servicio y conectividad de stw-planner.com.');
        }
    } catch (error) {
        resultado.ok = false;
        resultado.errores.push('STW Planner en vivo: ' + error.message);
        await paso('❌ STW Planner en vivo: ' + error.message + '.');
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

async function comandoRPavos(sock, chatId, msg) {
    const inicio = Date.now();
    let numeroEtapa = 0;
    const progreso = async (texto) => {
        numeroEtapa++;
        await sock.sendMessage(chatId, {
            text: '🪙 *R PAVOS — DIAGNÓSTICO DE DOS FUENTES*\n📍 Seguimiento ' + numeroEtapa +
                ' | ⏱️ ' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s\n\n' + String(texto).slice(0, 2800)
        }, { quoted: msg });
    };

    await progreso('ETAPA 0 — Comando recibido. Este comando solo consultará SeeBot.dev y FortniteDB. Cada fuente se ejecuta por separado; si una falla, la otra continuará.');

    // No ejecutar aquí diagnósticos de STW Planner ni de otros comandos.
    const fortniteDB = await consultarFortniteDB(progreso);
    await progreso('CAMBIO DE FUENTE — FortniteDB terminó. Ahora empieza SeeBot.dev, independientemente del resultado anterior.');
    const seeBot = await consultarSeeBot(progreso);

    const lineas = [
        '🪙 *RESULTADO FINAL — RPAVOS*',
        '',
        '🧭 *Comparación de fuentes*',
        'FortniteDB: ' + (fortniteDB.ok ? 'OK' : 'FALLÓ') + ' | alertas=' + fortniteDB.alertas.length + ' | total=' + (fortniteDB.ok ? fortniteDB.totalPavos : 'no disponible'),
        'SeeBot.dev: ' + (seeBot.ok ? 'OK' : 'FALLÓ') + ' | alertas=' + seeBot.alertas.length + ' | total=' + (seeBot.ok ? seeBot.totalPavos : 'no disponible'),
        ''
    ];

    if (fortniteDB.ok) {
        lineas.push('🌐 *FORTNITEDB — PA VOS EXTRAÍDOS*');
        for (const a of fortniteDB.alertas) lineas.push('• ' + a.zona + ' | PL ' + (a.pl ?? '?') + ' | ' + a.mision + ' | ' + a.cantidad + ' PaVos');
        lineas.push('*Total FortniteDB: ' + fortniteDB.totalPavos + ' PaVos*', '');
    } else {
        lineas.push('❌ *FORTNITEDB FALLÓ*', 'Último punto: ' + (fortniteDB.etapaFallo || 'no registrado'), 'Error exacto: ' + (fortniteDB.error || 'sin detalle'), '');
    }

    if (seeBot.ok) {
        lineas.push('🌐 *SEEBOT.DEV — PA VOS EXTRAÍDOS*');
        for (const a of seeBot.alertas) lineas.push('• ' + a.zona + ' | PL ' + (a.pl ?? '?') + ' | ' + a.mision + ' | ' + a.cantidad + ' PaVos');
        lineas.push('*Total SeeBot: ' + seeBot.totalPavos + ' PaVos*', '');
    } else {
        lineas.push('❌ *SEEBOT.DEV FALLÓ*', 'Último punto: ' + (seeBot.etapaFallo || 'no registrado'), 'Error exacto: ' + (seeBot.error || 'sin detalle'), '');
    }

    if (fortniteDB.ok && seeBot.ok) {
        // FortniteDB no expone el nombre de misión en su tabla de PaVos; comparamos zona, PL y cantidad.
        const clave = a => [String(a.zonaCodigo || a.zona || '').toLowerCase(), String(a.pl ?? ''), String(a.cantidad ?? '')].join('|');
        const restantesSee = new Map();
        for (const alerta of seeBot.alertas) {
            const k = clave(alerta);
            restantesSee.set(k, (restantesSee.get(k) || 0) + 1);
        }
        const soloDB = [];
        let coincidencias = 0;
        for (const alerta of fortniteDB.alertas) {
            const k = clave(alerta);
            const disponibles = restantesSee.get(k) || 0;
            if (disponibles > 0) {
                coincidencias++;
                restantesSee.set(k, disponibles - 1);
            } else {
                soloDB.push(alerta);
            }
        }
        const restantesDB = new Map();
        for (const alerta of fortniteDB.alertas) {
            const k = clave(alerta);
            restantesDB.set(k, (restantesDB.get(k) || 0) + 1);
        }
        const soloSee = [];
        for (const alerta of seeBot.alertas) {
            const k = clave(alerta);
            const disponibles = restantesDB.get(k) || 0;
            if (disponibles > 0) restantesDB.set(k, disponibles - 1);
            else soloSee.push(alerta);
        }
        lineas.push('🔍 *COMPARACIÓN DETALLADA*',
            'Coincidencias por zona + PL + cantidad: ' + coincidencias,
            'Solo en FortniteDB: ' + soloDB.length + (soloDB.length ? ' — ' + soloDB.map(a => a.zona + '/PL' + (a.pl ?? '?') + '/' + a.cantidad + ' PaVos').join('; ') : ''),
            'Solo en SeeBot: ' + soloSee.length + (soloSee.length ? ' — ' + soloSee.map(a => a.zona + '/PL' + (a.pl ?? '?') + '/' + a.cantidad + ' PaVos').join('; ') : ''),
            'Diferencia de totales: ' + (fortniteDB.totalPavos - seeBot.totalPavos) + ' PaVos');
    } else {
        lineas.push('⚠️ La comparación completa requiere que ambas fuentes extraigan datos correctamente.');
    }
    lineas.push('', '⏱️ Tiempo total: ' + ((Date.now() - inicio) / 1000).toFixed(2) + ' s', 'Support-a-Creator: *JASC13* ❤️');
    await sock.sendMessage(chatId, { text: lineas.join('\n') }, { quoted: msg });
}

module.exports = {
    consultarFortniteDB,
    consultarSeeBot,
    extraerDatosSeeBot,
    diagnosticarMenuFortnite,
    obtenerAlertasFortniteDB: async () => consultarFortniteDB(),
    comandoRPavos
};

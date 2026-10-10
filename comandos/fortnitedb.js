const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('../database/modelos');

const URL_FORTNITEDB = 'https://fortnitedb.com/index.php';
const URL_FORTNITEDB_RESPALDO = 'https://cdn.fortnitedb.com/index.php';
const URL_FORTNITEDB_ALTERNATIVA = 'https://fortnitedb.com/';
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
    const paso = async (texto) => {
        resultado.etapas.push(texto);
        await reportar(progreso, texto);
    };

    try {
        await paso('🌐 *FortniteDB 1/4:* conectando con https://fortnitedb.com/');
        let respuesta;
        const intentos = [
            { url: URL_FORTNITEDB, nombre: 'página principal' },
            { url: URL_FORTNITEDB_RESPALDO, nombre: 'espejo CDN' },
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
                const status = errorIntento.response?.status;
                const detalle = status ? 'HTTP ' + status : (errorIntento.code || errorIntento.message || 'error desconocido');
                fallos.push(intento.nombre + ': ' + detalle);
                await paso('⚠️ FortniteDB: falló ' + intento.nombre + ' — ' + detalle + '.');
            }
        }
        if (!respuesta) {
            throw new Error('No se pudo descargar ninguna ruta de FortniteDB. Detalles: ' + fallos.join(' | ') +
                '. Un HTTP 403 significa que el servidor/CDN bloqueó la petición; cambiar el parser no lo soluciona.');
        }
        resultado.http = respuesta.status;
        await paso('📥 *FortniteDB 2/4:* respuesta HTTP ' + respuesta.status + '; recibí ' + String(respuesta.data || '').length + ' caracteres.');

        const $ = cheerio.load(respuesta.data);
        await paso('🔎 *FortniteDB 3/4:* buscando la sección y tabla “V-Bucks Missions”.');
        const tabla = localizarTablaFortniteDB($);
        if (!tabla.length) throw new Error('La página respondió, pero no encontré la tabla “V-Bucks Missions”.');

        const filas = tabla.find('tr');
        await paso('📋 *FortniteDB 4/4:* encontré la tabla; revisando ' + filas.length + ' filas.');
        filas.each((_, fila) => {
            const celdas = $(fila).find('td');
            if (celdas.length < 4) return;
            const zonaCodigo = limpiar($(celdas[0]).text()).toUpperCase();
            const imagen = $(celdas[1]).find('img').first();
            const poderTexto = limpiar($(celdas[2]).text());
            const recompensa = limpiar($(celdas[3]).text());
            const matchPavos = recompensa.match(/(\d+)\s*x?\s*(?:V-Bucks|V\s*Bucks)/i);
            if (!matchPavos || !ZONAS[zonaCodigo]) return;
            const poderMatch = poderTexto.match(/\d+/);
            resultado.alertas.push({
                zona: ZONAS[zonaCodigo],
                zonaCodigo,
                pl: poderMatch ? Number(poderMatch[0]) : null,
                mision: nombreMisionFortniteDB(imagen.attr('src') || '', imagen.attr('alt') || ''),
                cantidad: Number(matchPavos[1])
            });
        });

        if (resultado.alertas.length === 0) {
            throw new Error('Encontré la tabla, pero no pude extraer ninguna alerta válida de PaVos. Puede haber cambiado el formato de sus filas.');
        }
        resultado.totalPavos = resultado.alertas.reduce((suma, alerta) => suma + alerta.cantidad, 0);
        resultado.ok = true;
        await paso('✅ *FortniteDB:* extracción terminada; ' + resultado.alertas.length + ' alertas, total detectado: ' + resultado.totalPavos + ' PaVos.');
    } catch (error) {
        resultado.error = error.message || String(error);
        resultado.ok = false;
        await paso('❌ *FortniteDB se trabó:* ' + resultado.error);
    }
    return resultado;
}

function extraerDatosSeeBot(html) {
    const patrones = [
        /makeHtml\s*\(/i,
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
    const paso = async (texto) => {
        resultado.etapas.push(texto);
        await reportar(progreso, texto);
    };

    try {
        await paso('🌐 *SeeBot 1/4:* conectando con https://seebot.dev/');
        const respuesta = await descargarPagina(URL_SEEBOT);
        resultado.http = respuesta.status;
        const html = String(respuesta.data || '');
        await paso('📥 *SeeBot 2/4:* respuesta HTTP ' + respuesta.status + '; recibí ' + html.length + ' caracteres.');

        await paso('🔎 *SeeBot 3/4:* buscando el bloque de datos de misiones dentro del HTML.');
        const misiones = extraerDatosSeeBot(html);
        await paso('📋 *SeeBot 4/4:* encontré ' + misiones.length + ' misiones; filtrando recompensas de PaVos.');

        for (const mision of misiones) {
            const zona = String(mision.zone || '').trim();
            if (!['Stonewood', 'Plankerton', 'Canny Valley', 'Twine Peaks'].includes(zona)) continue;
            const recompensas = Array.isArray(mision.alertRewards) ? mision.alertRewards : [];
            const recompensaPavos = recompensas.find(r => /v-bucks/i.test(String(r.itemType || '')));
            if (!recompensaPavos) continue;

            resultado.alertas.push({
                zona,
                zonaCodigo: ({ Stonewood: 'S', Plankerton: 'P', 'Canny Valley': 'C', 'Twine Peaks': 'T' })[zona],
                pl: Number(mision.powerLevel) || null,
                mision: nombreMisionSeeBot(mision.name),
                cantidad: Number(recompensaPavos.quantity) || 0
            });
        }

        if (resultado.alertas.length === 0) {
            throw new Error('Leí las misiones, pero no encontré recompensas cuyo nombre contenga “V-Bucks” en alertRewards.');
        }
        resultado.totalPavos = resultado.alertas.reduce((suma, alerta) => suma + alerta.cantidad, 0);
        resultado.ok = true;
        await paso('✅ *SeeBot.dev:* extracción terminada; ' + resultado.alertas.length + ' alertas, total detectado: ' + resultado.totalPavos + ' PaVos.');
    } catch (error) {
        resultado.error = error.message || String(error);
        resultado.ok = false;
        await paso('❌ *SeeBot.dev se trabó:* ' + resultado.error);
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
    const comandos = ['pavos', 'destacadasstw', 'epicasstw', 'legendariasstw', 'alertasstw', 'alerta', 'setgrupostw', 'unsetgrupostw'];
    await paso('🧭 *Menú Fortnite:* comprobando los datos guardados y la cobertura de comandos.');
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
            const registrado = new RegExp("['\\\"]" + comando + "['\\\"]").test(handler);
            const anunciado = menu.includes(comando);
            const correcto = registrado && anunciado;
            await paso((correcto ? '✅ ' : '❌ ') + 'Comando ' + comando + ': ' +
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
        resultado.ok ? 'Alertas encontradas: ' + resultado.alertas.length : 'Error: ' + resultado.error
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
    const progreso = async (texto) => {
        await sock.sendMessage(chatId, { text: '🧪 *DIAGNÓSTICO RPAVOS*\n\n' + texto }, { quoted: msg });
    };

    await progreso('🚦 Inicio del diagnóstico. Consultaré ambas páginas de forma independiente; si una falla, continuaré con la otra.');

    const [fortniteDB, seeBot, menuFortnite] = await Promise.all([
        consultarFortniteDB(progreso),
        consultarSeeBot(progreso),
        diagnosticarMenuFortnite(progreso)
    ]);

    const lineas = [
        '🧪 *RESULTADO FINAL DEL DIAGNÓSTICO RPAVOS*',
        '',
        formatearFuente(fortniteDB),
        '',
        formatearFuente(seeBot),
        '',
        (menuFortnite.ok ? '✅' : '⚠️') + ' *MENÚ FORTNITE / STW PLANNER*',
        ...menuFortnite.pruebas,
        ...(menuFortnite.errores.length ? ['', '*Problemas detectados:*', ...menuFortnite.errores.map(e => '• ' + e)] : []),
        '',
        '⏱️ Tiempo total: ' + ((Date.now() - inicio) / 1000).toFixed(1) + ' s',
        '',
        'Support-a-Creator: *JASC13* ❤️'
    ];

    if (fortniteDB.ok && seeBot.ok) {
        const diferencia = fortniteDB.totalPavos - seeBot.totalPavos;
        lineas.push('', '🧮 Diferencia entre fuentes: ' + (diferencia > 0 ? '+' : '') + diferencia + ' PaVos.');
    } else {
        lineas.push('', '⚠️ Una o ambas fuentes fallaron; revisa arriba la última etapa reportada para cada página.');
    }

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

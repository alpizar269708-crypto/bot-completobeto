const axios = require('axios');
const cheerio = require('cheerio');

const URL_FORTNITEDB = 'https://fortnitedb.com/';
const URL_SEEBOT = 'https://seebot.dev/';

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
        const respuesta = await descargarPagina(URL_FORTNITEDB);
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
    const inicioLlamada = html.indexOf('makeHtml([');
    if (inicioLlamada < 0) {
        throw new Error('La página cargó, pero no encontré el bloque makeHtml([...]) con los datos de misiones.');
    }

    const inicioJson = inicioLlamada + 'makeHtml('.length;
    const cierreScript = html.indexOf('</script>', inicioJson);
    const finLlamada = html.indexOf(');', inicioJson);
    if (finLlamada < 0 || (cierreScript >= 0 && finLlamada > cierreScript)) {
        throw new Error('Encontré makeHtml, pero no el cierre del bloque de datos antes de terminar el script.');
    }

    let misiones;
    try {
        misiones = JSON.parse(html.slice(inicioJson, finLlamada).trim());
    } catch (error) {
        throw new Error('Encontré el bloque de misiones, pero el JSON no se pudo interpretar: ' + error.message);
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

    const fortniteDB = await consultarFortniteDB(progreso);
    const seeBot = await consultarSeeBot(progreso);

    const lineas = [
        '🧪 *RESULTADO FINAL DEL DIAGNÓSTICO RPAVOS*',
        '',
        formatearFuente(fortniteDB),
        '',
        formatearFuente(seeBot),
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
    obtenerAlertasFortniteDB: async () => consultarFortniteDB(),
    comandoRPavos
};

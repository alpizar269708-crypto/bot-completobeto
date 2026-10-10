const axios = require('axios');
const cheerio = require('cheerio');

const URL_FORTNITEDB = 'https://fortnitedb.com/';

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

function obtenerNombreMision(icono, alt = '') {
    const referencia = (String(icono || '') + ' ' + String(alt || '')).toLowerCase();

    if (referencia.includes('icon-mission-data') || referencia.includes('retrieve-the-data')) {
        return 'Recupera los datos';
    }
    if (referencia.includes('t-icon-ride') || referencia.includes('ride-the-lightning')) {
        return 'Viaja en el rayo';
    }
    if (referencia.includes('repair-the-shelter')) return 'Repara el refugio';
    if (referencia.includes('fight-the-storm')) return 'Lucha contra la tormenta';
    if (referencia.includes('evacuate-the-shelter')) return 'Evacúa el refugio';
    if (referencia.includes('deliver-the-bomb')) return 'Entrega la bomba';
    if (referencia.includes('rescue-the-survivors')) return 'Rescata a los supervivientes';
    if (referencia.includes('build-the-radar')) return 'Construye el radar';
    return 'Misión de alerta';
}

function localizarTablaResumen($) {
    const encabezado = $('h1, h2, h3, h4, h5, h6, .title, .block-title')
        .filter((_, el) => limpiar($(el).text()).toLowerCase().includes('v-bucks missions'))
        .first();

    if (!encabezado.length) return $();

    // El HTML de FortniteDB coloca la tabla resumen dentro del bloque
    // que contiene el encabezado "V-Bucks Missions".
    const bloque = encabezado.closest('.new_block_block');
    if (bloque.length) {
        const tabla = bloque.find('table.summary-honorable, table.summary-wrapper, table').first();
        if (tabla.length) return tabla;
    }

    // Respaldo por si FortniteDB cambia los contenedores pero conserva el título.
    let contenedor = encabezado.parent();
    for (let i = 0; i < 5 && contenedor.length; i++, contenedor = contenedor.parent()) {
        const tabla = contenedor.find('table.summary-honorable, table.summary-wrapper').first();
        if (tabla.length) return tabla;
    }

    return $();
}

async function obtenerAlertasFortniteDB() {
    const respuesta = await axios.get(URL_FORTNITEDB, {
        timeout: 25000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    const $ = cheerio.load(respuesta.data);
    const tabla = localizarTablaResumen($);

    if (!tabla.length) {
        throw new Error('FortniteDB respondió, pero no encontré la tabla de V-Bucks Missions. Puede haber cambiado el HTML.');
    }

    const alertas = [];
    tabla.find('tbody tr').each((_, fila) => {
        const celdas = $(fila).find('td');
        if (celdas.length < 4) return;

        const zonaCodigo = limpiar($(celdas[0]).text()).toUpperCase();
        const icono = $(celdas[1]).find('img').attr('src') || '';
        const alt = $(celdas[1]).find('img').attr('alt') || '';
        const poderTexto = limpiar($(celdas[2]).text());
        const recompensa = limpiar($(celdas[3]).text());
        const matchPavos = recompensa.match(/(\d+)\s*x?\s*(?:V-Bucks|V\s*Bucks)/i);

        if (!matchPavos || !ZONAS[zonaCodigo]) return;

        const poderMatch = poderTexto.match(/\d+/);
        alertas.push({
            zona: ZONAS[zonaCodigo],
            zonaCodigo,
            pl: poderMatch ? Number(poderMatch[0]) : null,
            mision: obtenerNombreMision(icono, alt),
            cantidad: Number(matchPavos[1])
        });
    });

    if (alertas.length === 0) {
        throw new Error('La página cargó, pero no se encontraron alertas de PaVos válidas en la tabla resumen.');
    }

    const fecha = new Date().toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Mexico_City'
    });

    return {
        fecha,
        consultadoEn: new Date().toISOString(),
        alertas,
        totalPavos: alertas.reduce((total, alerta) => total + alerta.cantidad, 0)
    };
}

async function comandoRPavos(sock, chatId, msg) {
    try {
        const datos = await obtenerAlertasFortniteDB();
        const lineas = [
            '🧪 *PRUEBA DE RESPALDO — FORTNITEDB*',
            '📅 _' + datos.fecha + '_',
            '',
            '🎮 *ALERTAS DE PAVOS*',
            ''
        ];

        for (const alerta of datos.alertas) {
            lineas.push(
                '🌍 *Zona:* ' + alerta.zona,
                '⚡ *PL:* ' + (alerta.pl ?? 'No disponible'),
                '🎯 *Misión:* ' + alerta.mision,
                '🪙 *PaVos:* ' + alerta.cantidad,
                ''
            );
        }

        lineas.push(
            '💰 *Total del día:* ' + datos.totalPavos + ' PaVos',
            '',
            '🔎 _Fuente: FortniteDB (consulta en vivo)_',
            'Support-a-Creator: *JASC13* ❤️'
        );

        await sock.sendMessage(chatId, { text: lineas.join('\n') }, { quoted: msg });
    } catch (error) {
        console.error('❌ Error en rpavos / FortniteDB:', error.message);
        await sock.sendMessage(chatId, {
            text: '❌ *No pude consultar FortniteDB.*\n\n' +
                'El comando de respaldo no enviará datos guardados ni inventados.\n' +
                'Detalle: ' + (error.message || 'error desconocido')
        }, { quoted: msg });
    }
}

module.exports = { obtenerAlertasFortniteDB, comandoRPavos };

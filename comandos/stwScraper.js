const cheerio = require('cheerio');

const URL_FORTNITEDB = 'https://fortnitedb.com/';

// Letra de zona -> nombre real de zona en el juego
const ZONAS = {
    S: 'Stonewood',
    P: 'Plankerton',
    C: 'Cumbres Leñosas', // Canny Valley
    T: 'Valle Latoso',    // Twine Peaks (nombres "clásicos" en español LatAm)
    V: 'Ventures'
};

// Cache simple en memoria para no golpear el sitio en cada mensaje
let cache = { datos: null, timestamp: 0 };
const TTL_CACHE_MS = 5 * 60 * 1000; // 5 minutos

function limpiarTexto(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
}

// Busca el primer <table>...</table> que aparece después de un texto dado
// dentro del HTML crudo, y lo devuelve ya cargado en un cheerio aparte.
function extraerTablaDespuesDe(htmlCompleto, textoBuscado) {
    const idxTexto = htmlCompleto.indexOf(textoBuscado);
    if (idxTexto === -1) return null;

    const idxTablaInicio = htmlCompleto.indexOf('<table', idxTexto);
    if (idxTablaInicio === -1) return null;

    const idxTablaFin = htmlCompleto.indexOf('</table>', idxTablaInicio);
    if (idxTablaFin === -1) return null;

    const fragmentoTabla = htmlCompleto.slice(idxTablaInicio, idxTablaFin + '</table>'.length);
    return cheerio.load(fragmentoTabla);
}

async function descargarHTML() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // FortniteDB sirve la portada detrás de una caché de CDN/Varnish que a
    // veces no se refresca justo después del reset diario de misiones.
    // Truco: mandamos un query param que cambia en cada request (rompe la
    // "cache key" del CDN, obligándolo a ir al origen) + headers no-cache,
    // por si el proxy sí los respeta.
    const urlSinCache = `${URL_FORTNITEDB}?_=${Date.now()}`;

    try {
        const respuesta = await fetch(urlSinCache, {
            signal: controller.signal,
            cache: 'no-store',
            headers: {
                // Un User-Agent de navegador real evita bloqueos de WAF/CDN
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });

        if (!respuesta.ok) {
            throw new Error(`FortniteDB respondió ${respuesta.status}`);
        }

        return await respuesta.text();
    } finally {
        clearTimeout(timeout);
    }
}

// Extrae "Missions Expire : 2026-09-16 00:00:00" para poder verificar que
// lo que scrapeamos de verdad corresponde al día de hoy y no a una versión
// vieja cacheada por el CDN de FortniteDB.
function extraerFechaExpiracion(htmlCompleto) {
    const match = htmlCompleto.match(/Missions Expire\s*:?\s*(\d{4}-\d{2}-\d{2})/i);
    return match ? match[1] : null;
}

// Parsea la tabla "Miniboss V-Bucks Missions" (la alerta real de paVos)
function parsearAlertaVbucks($tabla) {
    const misiones = [];

    $tabla('tr').each((_, fila) => {
        const celdas = $tabla(fila).find('td, th');
        if (celdas.length < 3) return;

        const textoCeldas = celdas.map((__, c) => limpiarTexto($tabla(c).text())).get();
        const htmlFila = $tabla(fila).html() || '';

        // Si la fila dice explícitamente que no hay misiones, la ignoramos
        if (/no missions found/i.test(textoCeldas.join(' '))) return;

        // Zona: primera celda suele ser la letra (S/P/C/T/V)
        const letraZona = textoCeldas[0]?.trim().toUpperCase();
        if (!letraZona || !ZONAS[letraZona]) return;

        // Power Level: primer número "suelto" entre las celdas
        const celdaConPL = textoCeldas.find(t => /^\d{1,3}$/.test(t));
        const pl = celdaConPL ? parseInt(celdaConPL, 10) : null;

        // Cantidad de V-Bucks: buscamos patrón "50x V-Bucks" o similar
        const matchCantidad = htmlFila.match(/(\d+)\s*x?\s*V[-\s]?Bucks/i)
            || textoCeldas.join(' ').match(/(\d+)\s*x?\s*V[-\s]?Bucks/i);
        const cantidad = matchCantidad ? parseInt(matchCantidad[1], 10) : 50;

        misiones.push({
            zona: ZONAS[letraZona],
            mision: 'Alerta de paVos (Miniboss)',
            cantidad,
            pl: pl || '?',
            modificadores: 'Mini-Boss'
        });
    });

    return misiones;
}

// Función principal: devuelve { pavos, legendarias, fuente, actualizado }
// legendarias queda vacío por ahora: FortniteDB no expone un widget
// equivalente y tan simple para eso en la portada (ver README abajo).
async function obtenerAlertasSTWReal() {
    const ahora = Date.now();
    if (cache.datos && ahora - cache.timestamp < TTL_CACHE_MS) {
        return cache.datos;
    }

    const html = await descargarHTML();
    const $tabla = extraerTablaDespuesDe(html, 'Miniboss V-Bucks Missions');

    let pavos = [];
    if ($tabla) {
        pavos = parsearAlertaVbucks($tabla);
    }

    // Verificación anti-caché-vieja: si "Missions Expire" ya pasó hace más
    // de un día respecto a hoy, es señal de que seguimos viendo una versión
    // cacheada del sitio y no la de hoy.
    const fechaExpiracion = extraerFechaExpiracion(html);
    let posiblementeDesactualizado = false;
    if (fechaExpiracion) {
        const hoyISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // YYYY-MM-DD
        const expiraDate = new Date(fechaExpiracion + 'T00:00:00');
        const hoyDate = new Date(hoyISO + 'T00:00:00');
        // Si la fecha de expiración es anterior a hoy, el ciclo ya terminó
        // y deberíamos estar viendo el próximo, no éste.
        if (expiraDate < hoyDate) {
            posiblementeDesactualizado = true;
        }
    }

    const resultado = {
        pavos,
        legendarias: [], // ver nota en fortnite.js sobre esto
        fuente: 'https://fortnitedb.com/',
        actualizado: new Date(),
        fechaExpiracionScrapeada: fechaExpiracion,
        posiblementeDesactualizado
    };

    cache = { datos: resultado, timestamp: ahora };
    return resultado;
}
const escuadronesActivos = new Map();

module.exports = { obtenerAlertasSTWReal };

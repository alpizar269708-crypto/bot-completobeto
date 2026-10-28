const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DOMINIOS_PERMITIDOS = [
    'fortnitedb.com',
    'stw-planner.com',
    'epicgames.com',
    'savetheworlddb.com',
    'founderbacon.com'
];
const CACHE_TTL = 30 * 60 * 1000;
const cacheBuilds = new Map();

function limpiar(texto) {
    return String(texto || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function urlPermitida(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && DOMINIOS_PERMITIDOS.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
    } catch (_) {
        return false;
    }
}

async function buscarPaginas(nombre) {
    const consulta = encodeURIComponent('Fortnite Save the World "' + nombre + '" weapon perks build hero');
    const respuesta = await axios.get('https://html.duckduckgo.com/html/?q=' + consulta, {
        timeout: 12000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    const $ = cheerio.load(respuesta.data);
    const enlaces = [];
    $('.result').each((_, el) => {
        const a = $(el).find('.result__a').first();
        let url = a.attr('href') || '';
        try {
            const parsed = new URL(url, 'https://duckduckgo.com');
            url = parsed.searchParams.get('uddg') || url;
        } catch (_) {}
        if (!urlPermitida(url)) return;
        const titulo = limpiar(a.text());
        const descripcion = limpiar($(el).find('.result__snippet').text());
        if (!enlaces.some(x => x.url === url)) enlaces.push({ titulo, url, descripcion });
    });
    return enlaces.slice(0, 5);
}

async function extraerPagina(fuente) {
    try {
        const respuesta = await axios.get(fuente.url, {
            timeout: 10000,
            maxRedirects: 4,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const $ = cheerio.load(respuesta.data);
        $('script, style, nav, footer, header, noscript, iframe, form').remove();
        const texto = limpiar($('main').text() || $('article').text() || $('body').text()).slice(0, 8500);
        return { ...fuente, contenido: texto || fuente.descripcion };
    } catch (_) {
        return { ...fuente, contenido: fuente.descripcion || '' };
    }
}

async function generarResumen(nombre, fuentes) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return null;
    const contexto = fuentes.map((f, i) =>
        '[' + (i + 1) + '] ' + f.titulo + '\nURL: ' + f.url + '\n' + (f.contenido || f.descripcion || '').slice(0, 6000)
    ).join('\n\n---\n\n');

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelo = genAI.getGenerativeModel({
        model: 'gemini-3.6-flash',
        systemInstruction: [
            'Eres un especialista en Fortnite: Salvar el Mundo.',
            'Responde en español mexicano, claro y práctico, para WhatsApp.',
            'Usa exclusivamente los datos incluidos en las fuentes suministradas.',
            'No inventes estadísticas, nombres de perks, porcentajes, costes, materiales ni efectos.',
            'Separa claramente datos que aparecen en las fuentes de tus recomendaciones razonadas.',
            'Si las fuentes no confirman un dato, omítelo o di que no se pudo confirmar.',
            'Para armas, prioriza ventajas/perks, sexta ventaja, elemento y estilo de uso si la fuente los menciona.',
            'Para héroes, explica habilidad, ventaja estándar/comandante y equipo o sinergias solo si están documentados.',
            'Incluye una recomendación de configuración solo cuando los datos recopilados la respalden.',
            'No inventes ni cites fuentes que no estén en el contexto.',
            'Máximo 2600 caracteres antes de la sección de fuentes.'
        ].join(' ')
    });
    const resultado = await modelo.generateContent(
        'Investiga este objeto de Fortnite: Salvar el Mundo: "' + nombre + '". ' +
        'Primero identifica si es arma o héroe si las fuentes lo permiten. Después resume datos verificados, ' +
        'build/perks recomendados, por qué sirven, alternativas si hay evidencia y cualquier limitación. ' +
        'Termina con una sección "Fuentes consultadas" enumerando los títulos y URL exactos que aparecen abajo.\n\n' + contexto
    );
    return resultado.response.text().trim();
}

async function comandoBuildSTW(sock, chatId, msg, args) {
    const nombre = limpiar((args || []).join(' '));
    if (!nombre) {
        await sock.sendMessage(chatId, {
            text: '🔫 *BUILDS DE SALVAR AL MUNDO*\n\nEscribe el comando seguido del nombre exacto del arma o héroe.\n\nEjemplos:\n• *buildstw Nocturno*\n• *buildstw Siegebreaker*\n• *buildstw Ramirez*\n\nBuscaré datos en páginas especializadas y te separaré la información encontrada de las recomendaciones.\n\nApoya a un creador: *JASC13*.'
        }, { quoted: msg });
        return;
    }

    const clave = nombre.toLocaleLowerCase('es-MX');
    const guardado = cacheBuilds.get(clave);
    if (guardado && guardado.expira > Date.now()) {
        await sock.sendMessage(chatId, { text: guardado.texto }, { quoted: msg });
        return;
    }

    await sock.sendMessage(chatId, {
        text: '🔎 *BUSCANDO BUILD STW*\n\nObjeto: *' + nombre + '*\nEstoy consultando fuentes especializadas. Si no encuentro datos verificables, te lo diré sin inventar perks.\n\nApoya a un creador: *JASC13*.'
    }, { quoted: msg });

    try {
        let resultados = await buscarPaginas(nombre);
        if (!resultados.length) {
            const texto = '⚠️ No encontré páginas especializadas accesibles que coincidan claramente con *' + nombre + '* en esta búsqueda. Comprueba la escritura o prueba el nombre en inglés que aparece en el juego. No voy a inventar una build.\n\nFuentes de consulta: https://fortnitedb.com/ · https://stw-planner.com/loadouts\n\nApoya a un creador: *JASC13*.';
            await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
            return;
        }
        const fuentes = await Promise.all(resultados.map(extraerPagina));
        const fuentesUtiles = fuentes.filter(f => (f.contenido || f.descripcion || '').length > 30);
        let resumen = null;
        try { resumen = await generarResumen(nombre, fuentesUtiles.length ? fuentesUtiles : resultados); }
        catch (error) { console.warn('No se pudo sintetizar la build STW:', error.message); }

        const listaFuentes = (fuentesUtiles.length ? fuentesUtiles : resultados)
            .slice(0, 5)
            .map((f, i) => (i + 1) + '. ' + f.titulo + '\n' + f.url)
            .join('\n');
        const cuerpo = resumen || (
            'No pude generar un resumen automático fiable. Estos son los resultados especializados encontrados para que puedas revisar los datos originales:\n\n' +
            resultados.slice(0, 5).map((f, i) => (i + 1) + '. *' + f.titulo + '*\n' + (f.descripcion || 'Sin descripción en el resultado.') + '\n' + f.url).join('\n\n')
        );
        const texto = '🔫 *BUILD STW: ' + nombre.toUpperCase() + '*\n\n' + cuerpo +
            '\n\n🔗 *Fuentes consultadas*\n' + listaFuentes +
            '\n\nℹ️ Las páginas pueden actualizarse; revisa la fuente original antes de gastar materiales. Si algún dato no aparece en las fuentes, no se da por confirmado.\n\nApoya a un creador: *JASC13*.';
        cacheBuilds.set(clave, { texto, expira: Date.now() + CACHE_TTL });
        await sock.sendMessage(chatId, { text }, { quoted: msg });
    } catch (error) {
        console.error('Error buscando build STW:', error.stack || error.message);
        await sock.sendMessage(chatId, {
            text: '⚠️ No pude consultar las páginas de builds en este momento. Inténtalo más tarde. No he generado una build con datos inventados.\n\nPuedes revisar https://fortnitedb.com/ y https://stw-planner.com/loadouts.\n\nApoya a un creador: *JASC13*.'
        }, { quoted: msg });
    }
}

module.exports = { comandoBuildSTW };

const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DOMINIOS_PERMITIDOS = [
    'fortnitedb.com',
    'stw-planner.com',
    'epicgames.com',
    'savetheworlddb.com',
    'founderbacon.com',
    'fortnite.fandom.com',
    'fortnite-archive.fandom.com',
    'fortoffans.com'
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
            'No inventes datos que no puedas respaldar con el contenido recuperado.',
            'Separa claramente los datos encontrados de tus recomendaciones razonadas.',
            'Si no se encuentra información suficiente, dilo brevemente y no completes con suposiciones.',
            'Para armas, prioriza ventajas/perks, sexta ventaja, elemento y estilo de uso si la fuente los menciona.',
            'Para héroes, explica habilidad, ventaja estándar/comandante y equipo o sinergias solo si están documentados.',
            'Incluye una recomendación de configuración solo cuando los datos recopilados la respalden.',
            'No incluyas enlaces, citas, nombres de páginas ni una sección de fuentes en la respuesta al usuario.',
            'Máximo 2600 caracteres.'
        ].join(' ')
    });
    const resultado = await modelo.generateContent(
        'Investiga este objeto de Fortnite: Salvar el Mundo: "' + nombre + '". ' +
        'Primero identifica si es arma o héroe si las fuentes lo permiten. Después resume datos verificados, ' +
        'build/perks recomendados, por qué sirven, alternativas si hay evidencia y cualquier limitación. ' +
        'No menciones páginas, fuentes, enlaces ni referencias en la respuesta final.\n\n' + contexto
    );
    return resultado.response.text().trim();
}

async function comandoBuildSTW(sock, chatId, msg, args) {
    const nombre = limpiar((args || []).join(' '));
    if (!nombre) {
        await sock.sendMessage(chatId, {
            text: `🔫 *BUILDS DE SALVAR AL MUNDO*

Escribe el comando seguido del nombre del arma o héroe.

Ejemplos:
• *buildstw Siegebreaker*
• *buildstw Grave Digger*
• *buildstw Ramirez*

Apoya a un creador: *JASC13*.`
        }, { quoted: msg });
        return;
    }

    const clave = nombre.toLocaleLowerCase('es-MX');
    const guardado = cacheBuilds.get(clave);
    if (guardado && guardado.expira > Date.now()) {
        console.info('[buildstw] Resultado servido desde caché:', { nombre });
        await sock.sendMessage(chatId, { text: guardado.texto }, { quoted: msg });
        return;
    }

    let etapa = 'Inicio del comando';
    const registroEtapa = (nuevaEtapa, datos = {}) => {
        etapa = nuevaEtapa;
        console.info('[buildstw] ' + etapa, { nombre, ...datos });
    };

    await sock.sendMessage(chatId, {
        text: `🔎 *BUSCANDO BUILD STW*

Objeto: *${nombre}*
Buscando información para preparar la recomendación.

Apoya a un creador: *JASC13*.`
    }, { quoted: msg });

    try {
        registroEtapa('Preparando consulta de búsqueda');
        registroEtapa('Consultando buscador DuckDuckGo');
        const resultados = await buscarPaginas(nombre);
        console.info('[buildstw] Resultados del buscador:', {
            nombre,
            cantidad: resultados.length,
            resultados: resultados.map(r => ({
                titulo: r.titulo,
                dominio: (() => { try { return new URL(r.url).hostname; } catch (_) { return 'URL no válida'; } })(),
                tieneDescripcion: Boolean(r.descripcion)
            }))
        });

        if (!resultados.length) {
            registroEtapa('Búsqueda terminada sin resultados permitidos');
            const texto = `⚠️ No encontré información de *${nombre}* en esta búsqueda. Comprueba el nombre e inténtalo de nuevo.

Apoya a un creador: *JASC13*.`;
            await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
            return;
        }

        registroEtapa('Descargando y extrayendo el contenido de las páginas', { cantidadResultados: resultados.length });
        const fuentes = await Promise.all(resultados.map(extraerPagina));
        const fuentesUtiles = fuentes.filter(f => (f.contenido || f.descripcion || '').length > 30);
        registroEtapa('Contenido extraído; preparando resumen con IA', {
            paginasEncontradas: resultados.length,
            paginasConContenido: fuentesUtiles.length
        });

        let resumen = null;
        try {
            resumen = await generarResumen(nombre, fuentesUtiles.length ? fuentesUtiles : resultados);
            registroEtapa('Resumen generado', { resumenVacio: !resumen });
        } catch (error) {
            console.error('[buildstw] Falló la generación del resumen con IA:', {
                etapa, name: error?.name, message: error?.message, code: error?.code,
                status: error?.response?.status, stack: error?.stack
            });
            throw Object.assign(new Error('Falló la generación del resumen con IA: ' + (error?.message || String(error))), {
                etapaError: 'Generación del resumen con IA',
                causa: error
            });
        }

        const cuerpo = resumen || ('No pude generar una recomendación para *' + nombre + '* con la información encontrada. Inténtalo con el nombre en inglés del juego.');
        const texto = `🔫 *BUILD STW: ${nombre.toUpperCase()}*

${cuerpo}

Apoya a un creador: *JASC13*.`;
        cacheBuilds.set(clave, { texto, expira: Date.now() + CACHE_TTL });
        registroEtapa('Enviando respuesta final a WhatsApp');
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
        registroEtapa('Proceso completado correctamente');
    } catch (error) {
        const causa = error?.causa || error;
        const etapaError = error?.etapaError || etapa;
        const nombreError = causa?.name || error?.name || 'Error';
        const mensajeError = causa?.message || error?.message || String(error);
        const codigoError = causa?.code || error?.code || 'No disponible';
        const estadoHttp = causa?.response?.status || error?.response?.status || 'No disponible';
        const urlError = causa?.config?.url || error?.config?.url || 'No disponible';
        const stackError = String(causa?.stack || error?.stack || 'Stack no disponible').slice(0, 2600);

        console.error('[buildstw] ERROR DETALLADO', {
            objeto: nombre, etapa: etapaError, nombreError, mensajeError, codigoError, estadoHttp, urlError,
            stack: causa?.stack || error?.stack
        });

        const detalle = `⚠️ *ERROR EN BUILDS STW*

Objeto: *${nombre}*
Proceso donde falló: *${etapaError}*
Tipo de error: ${nombreError}
Mensaje: ${mensajeError}
Código: ${codigoError}
Estado HTTP: ${estadoHttp}
URL implicada: ${urlError}

Detalle técnico:
${stackError}

Apoya a un creador: *JASC13*.`;
        try {
            await sock.sendMessage(chatId, { text: detalle }, { quoted: msg });
        } catch (errorEnvio) {
            console.error('[buildstw] También falló el envío del diagnóstico por WhatsApp:', errorEnvio?.stack || errorEnvio?.message || errorEnvio);
        }
    }
}
module.exports = { comandoBuildSTW };

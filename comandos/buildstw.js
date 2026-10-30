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
const sesionesReemplazoHeroes = new Map();
const SESION_REEMPLAZO_TTL = 5 * 60 * 1000;

function claveSesion(chatId, remitente) {
    return String(chatId) + ':' + String(remitente);
}

function preguntaHeroes() {
    return '\n\n🔄 *¿Te falta algún héroe?* Responde con el número o los números de los héroes que faltan. Ejemplos: *1,3,5*.';
}

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

const ALIAS_OBJETOS_STW = {
    'sepulturero': ['Grave Digger'],
    'grave digger': ['Sepulturero']
};

async function buscarPaginas(nombre) {
    const alias = ALIAS_OBJETOS_STW[limpiar(nombre).toLocaleLowerCase('es-MX')] || [];
    const nombresBusqueda = [nombre, ...alias];
    const consultas = [
        'Fortnite Save the World ' + nombresBusqueda.join(' ') + ' weapon perks build hero',
        'Fortnite Salvar el Mundo ' + nombresBusqueda.join(' ') + ' arma ventajas'
    ];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7'
    };
    const enlaces = [];
    const vistos = new Set();

    const agregarResultado = (url, titulo, descripcion, motor) => {
        try {
            const parsed = new URL(url);
            if (!urlPermitida(parsed.href) || vistos.has(parsed.href)) return;
            vistos.add(parsed.href);
            enlaces.push({ titulo: limpiar(titulo), url: parsed.href, descripcion: limpiar(descripcion), motor });
        } catch (_) {}
    };

    // Consulta directa a las APIs de búsqueda de las wikis, sin depender del HTML de los buscadores.
    for (const dominio of ['fortnite.fandom.com', 'fortnite-archive.fandom.com']) {
        for (const termino of nombresBusqueda) {
            try {
                console.info('[buildstw] Consultando API de wiki', { dominio, termino });
                const respuesta = await axios.get('https://' + dominio + '/api.php', {
                    timeout: 8000, headers,
                    params: { action: 'query', list: 'search', srsearch: '"' + termino + '" Fortnite Save the World', srlimit: 5, format: 'json' }
                });
                const paginas = respuesta.data?.query?.search || [];
                for (const pagina of paginas) {
                    agregarResultado('https://' + dominio + '/?curid=' + pagina.pageid, pagina.title, String(pagina.snippet || '').replace(/<[^>]*>/g, ' '), 'MediaWiki');
                }
            } catch (error) {
                console.warn('[buildstw] Falló la API de wiki:', { dominio, termino, name: error?.name, message: error?.message, code: error?.code, status: error?.response?.status });
            }
            if (enlaces.length >= 5) break;
        }
        if (enlaces.length >= 5) break;
    }

    // Buscadores externos como respaldo; cada espera tiene un límite menor.
    for (const consulta of consultas) {
        try {
            console.info('[buildstw] Consultando DuckDuckGo', { consulta });
            const respuesta = await axios.get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(consulta), {
                timeout: 9000, headers
            });
            const $ = cheerio.load(respuesta.data);
            $('.result').each((_, el) => {
                const a = $(el).find('.result__a').first();
                let url = a.attr('href') || '';
                try {
                    const parsed = new URL(url, 'https://duckduckgo.com');
                    url = parsed.searchParams.get('uddg') || url;
                } catch (_) {}
                agregarResultado(url, a.text(), $(el).find('.result__snippet').text(), 'DuckDuckGo');
            });
        } catch (error) {
            console.warn('[buildstw] DuckDuckGo falló; se intentará el siguiente motor:', {
                consulta, name: error?.name, message: error?.message, code: error?.code, status: error?.response?.status
            });
        }
        if (enlaces.length >= 5) break;
    }

    if (enlaces.length < 5) {
        for (const consulta of consultas) {
            try {
                console.info('[buildstw] Consultando Bing como respaldo', { consulta });
                const respuesta = await axios.get('https://www.bing.com/search?q=' + encodeURIComponent(consulta), {
                    timeout: 9000, headers
                });
                const $ = cheerio.load(respuesta.data);
                $('li.b_algo').each((_, el) => {
                    const a = $(el).find('h2 a').first();
                    const url = a.attr('href') || '';
                    const descripcion = $(el).find('.b_caption p, p').first().text();
                    agregarResultado(url, a.text(), descripcion, 'Bing');
                });
            } catch (error) {
                console.warn('[buildstw] Falló la búsqueda de respaldo:', {
                    motor: 'Bing', consulta, name: error?.name, message: error?.message, code: error?.code, status: error?.response?.status
                });
            }
            if (enlaces.length >= 5) break;
        }
    }

    console.info('[buildstw] Búsqueda finalizada', {
        cantidad: enlaces.length, motores: [...new Set(enlaces.map(x => x.motor))]
    });
    return enlaces.slice(0, 5).map(({ motor, ...resultado }) => resultado);
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

async function generarResumen(nombre, fuentes, evolucion = null) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return null;
    const contexto = fuentes.map((f, i) =>
        '[' + (i + 1) + '] ' + f.titulo + '\nURL: ' + f.url + '\n' + (f.contenido || f.descripcion || '').slice(0, 6000)
    ).join('\n\n---\n\n');

    const genAI = new GoogleGenerativeAI(apiKey);
    const instrucciones = [
        'Eres un experto práctico en builds de Fortnite: Salvar el Mundo.',
        'La prioridad es entregar una configuración jugable y concreta, no una ficha histórica del objeto.',
        'Responde en español mexicano, directo y sin explicaciones largas. Máximo 1000 caracteres.',
        'Formato obligatorio de WhatsApp: usa un solo asterisco para negritas (*texto*), nunca doble asterisco. Usa títulos breves y listas simples.',
        'No expliques por qué funciona la build ni describas el arma. Devuelve solo listas claras con los perks y los héroes. Sin introducción, párrafos, historia, consejos ni alternativas salvo que sean indispensables.',
        'No inventes estadísticas exactas ni afirmes que una ventaja está disponible en el arma si las fuentes no lo confirman.',
        'Si se proporciona una evolución/material actual del arma, debes respetarlo y recomendar perks y evolución compatibles con ese nivel. No sugieras volver a una evolución inferior ni reiniciar la progresión. Si el usuario ya indicó una evolución, no la cambies por tu cuenta.',
        'Sí puedes recomendar una configuración meta razonada aunque las páginas recuperadas no enumeren todos los perks; marca claramente qué es recomendación y qué dato no se pudo confirmar.',
        'Si el usuario escribe un arma, responde solo con los perks recomendados en orden y los héroes de la build: comandante + cinco apoyos. No agregues ventaja de equipo ni expliques qué aporta cada héroe, a menos que sea imprescindible.',
        'En perks, usa nombres prácticos en español y respeta estrictamente el orden de las casillas del esquema. No asumas que todas las armas tienen las mismas opciones: recomienda solo perks compatibles con el arma y, si no puedes confirmar una opción exacta, indícalo brevemente.',
        'Reglas de prioridad para armas de cinco casillas de perks: casilla 1 = elemento apropiado para el tipo de enemigo; energía es una opción generalista cuando no hay una razón para otro elemento. Casilla 2 = prioriza daño; considera probabilidad crítica, impacto o estabilidad como alternativas si la mecánica del arma lo favorece y el esquema lo permite.',
        'Casilla 3 = prioriza velocidad de recarga para reducir el tiempo sin disparar; considera impacto, estabilidad, durabilidad/vida útil o daño según el arma y sus opciones reales.',
        'Casilla 4 = prioriza daño crítico si la build puede aprovechar críticos; considera aflicción/clasificación, daño u otra opción compatible cuando convenga más.',
        'Casilla 5 = elige según el objetivo y las opciones reales: clasificación/probabilidad crítica, daño contra monstruos, daño contra objetivos o daño a objetos. No confundas probabilidad crítica con daño crítico ni recomiendes todos esos perks a la vez por defecto.',
        'Objetivo general: reducir el tiempo para eliminar enemigos combinando daño y menor tiempo muerto por recarga, pero adapta la configuración a cada arma. No uses una plantilla fija de crítico para todas las armas ni inventes nombres de perks.',
        'Si el usuario escribe un héroe, entrega solo el equipo de seis héroes (comandante + cinco apoyos) que lo aproveche mejor y los perks del arma recomendada si corresponde. No le pidas al usuario que elija el héroe.',
        'Formato obligatorio: PERKS: lista numerada en orden. HÉROES: lista numerada del 1 al 6, donde 1 es Comandante y 2-6 son los cinco apoyos. Escribe un héroe por número y no omitas la numeración. Solo nombres y configuración. No inventes nombres, héroes ni perks; si algo no se puede verificar, márcalo en una nota de una sola línea.',
        'No incluyas datos históricos, explicación de la build, estilo de juego, enlaces ni sección de fuentes.',
        'No respondas únicamente que faltan datos, no des una recomendación genérica vacía y no incluyas enlaces, citas, nombres de páginas ni sección de fuentes.'
    ].join(' ');
    const contextoEvolucion = evolucion ? ' EVOLUCIÓN ACTUAL INDICADA POR EL USUARIO: ' + evolucion + '. Conserva esta evolución en la recomendación; no propongas bajarla ni reemplazarla.' : ' El usuario no indicó la evolución actual; recomienda perks apropiados y no inventes una evolución confirmada.';
    const prompt = 'Prepara una BUILD RECOMENDADA para Fortnite: Salvar el Mundo con este objeto: "' + nombre + '".' + contextoEvolucion + ' ' +
        'Devuelve únicamente la configuración final, sin explicación. Numera los seis héroes del 1 al 6 (1 = Comandante; 2-6 = apoyos). ' +
        'Si el nombre es un arma: lista sus perks en orden y después comandante + cinco héroes de apoyo. ' +
        'Si el nombre es un héroe: lista el comandante + cinco apoyos de la build que mejor lo aproveche y los perks del arma recomendada si aplica. ' +
        'No agregues motivos, consejos, historia, ventaja de equipo ni alternativas. ' +
        'Si es el Sepulturero/Grave Digger, trátalo como rifle de asalto y céntrate en daño sostenido/impacto crítico; no gastes la respuesta en su historia. ' +
        'Para armas, organiza los perks en el orden exacto de las casillas del esquema y aplica estas prioridades: 1 elemento; 2 daño o alternativa compatible como probabilidad crítica/impacto/estabilidad; 3 recarga, impacto, estabilidad, durabilidad o daño; 4 daño crítico, aflicción/clasificación o daño; 5 probabilidad/clasificación crítica o daño contra monstruos, objetivos u objetos. Elige solo opciones compatibles con esa arma y adapta la recomendación a su función; el objetivo habitual es aumentar el daño y reducir el tiempo para eliminar enemigos. ' +
        'No afirmes que un perk específico existe en ese esquema salvo que esté confirmado en el contexto. ' +
        'Si la información recuperada es pobre, usa conocimiento general del juego para dar una recomendación razonada y distingue lo no verificado.\n\n' + contexto;

    // Si el modelo principal está saturado (503/429), probar un modelo alternativo.
    let ultimoError = null;
    for (const nombreModelo of ['gemini-3.8-flash']) {
        try {
            const modelo = genAI.getGenerativeModel({ model: nombreModelo, systemInstruction: instrucciones });
            const resultado = await modelo.generateContent(prompt);
            const texto = resultado.response.text().trim().replaceAll('**', '*').slice(0, 1000);
            if (texto) return texto;
        } catch (error) {
            ultimoError = error;
            const mensaje = String(error?.message || error);
            console.warn('[buildstw] Modelo Gemini falló; se probará alternativa si queda disponible:', {
                modelo: nombreModelo, mensaje: mensaje.slice(0, 500)
            });
            if (!/(503|429|high demand|overloaded|temporar|unavailable|rate.?limit)/i.test(mensaje)) throw error;
        }
    }

    // No se pierde la consulta si Gemini está temporalmente fuera de servicio.
    // Se devuelve un resumen extractivo de los datos recuperados, sin inventar perks.
    const fragmentos = fuentes.map(f => {
        const contenido = limpiar(f.contenido || f.descripcion || '');
        return contenido ? contenido.slice(0, 900) : '';
    }).filter(Boolean);
    if (fragmentos.length) {
        return 'No pude generar una build automática porque el servicio de IA está temporalmente saturado.\n\n' +
            'Información recuperada sobre ' + nombre + ':\n' + fragmentos.slice(0, 3).join('\n\n').slice(0, 2200) +
            '\n\nIntenta de nuevo más tarde para obtener una recomendación organizada.';
    }
    if (ultimoError) throw ultimoError;
    return null;
}

async function generarReemplazosHeroes(nombre, buildActual, indices, fuentes) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('La IA no está configurada para recomendar reemplazos.');
    const contexto = (fuentes || []).map((f, i) =>
        '[' + (i + 1) + '] ' + f.titulo + '\n' + (f.contenido || f.descripcion || '').slice(0, 3500)
    ).join('\n\n---\n\n').slice(0, 12000);
    const genAI = new GoogleGenerativeAI(apiKey);
    const instrucciones = [
        'Eres experto práctico en builds de Fortnite: Salvar el Mundo.',
        'Responde en español mexicano, breve, usando formato WhatsApp con un solo asterisco para negritas.',
        'El usuario no tiene los héroes identificados por estos números: ' + indices.join(', ') + '.',
        'Esto puede ser una build solicitada por nombre de arma o una build centrada en un héroe. Identifica el tipo a partir de la build actual y del nombre solicitado.',
        'Sustituye solamente los héroes cuyos números indicó el usuario. Conserva exactamente los perks del arma recomendada y los héroes de los números no señalados.',
        'Si la build está centrada en un héroe y el usuario pide sustituir precisamente ese héroe, recomienda un reemplazo que mantenga una función parecida en la build; si no pidió sustituirlo, consérvalo.',
        'Si es una build de arma, conserva los perks y reemplaza solo los héroes solicitados. Si es una build centrada en un héroe, conserva los perks del arma recomendada y reemplaza solo los héroes solicitados.',
        'Respeta las posiciones: 1 es Comandante y 2-6 son apoyos. Devuelve la build completa con perks cuando correspondan y los seis héroes numerados del 1 al 6.',
        'Recomienda héroes reales de Salvar el Mundo que sean sustitutos razonables para esa build. No inventes nombres ni cambies los héroes no seleccionados.',
        'No incluyas explicación, introducción, alternativas ni comentarios.'
    ].join(' ');
    const prompt = 'El usuario está usando esta build para "' + nombre + '". Reemplaza únicamente los héroes de estas posiciones: ' + indices.join(', ') + '.\n\nBUILD ACTUAL:\n' + buildActual + '\n\nCONTEXTO RECUPERADO:\n' + contexto;
    let ultimoError;
    for (const modeloNombre of ['gemini-3.8-flash']) {
        try {
            const modelo = genAI.getGenerativeModel({ model: modeloNombre, systemInstruction: instrucciones });
            const resultado = await modelo.generateContent(prompt);
            const texto = resultado.response.text().trim().replaceAll('**', '*').slice(0, 1000);
            if (texto) return texto;
        } catch (error) {
            ultimoError = error;
            const mensaje = String(error?.message || error);
            if (!/(503|429|high demand|overloaded|temporar|unavailable|rate.?limit)/i.test(mensaje)) throw error;
        }
    }
    throw ultimoError || new Error('No se pudieron generar los reemplazos.');
}

async function manejarRespuestaBuildSTW(sock, chatId, msg, remitente, textoOriginal) {
    const clave = claveSesion(chatId, remitente);
    const sesion = sesionesReemplazoHeroes.get(clave);
    if (!sesion) return false;
    if (sesion.expira <= Date.now()) {
        sesionesReemplazoHeroes.delete(clave);
        return false;
    }
    const texto = String(textoOriginal || '').trim().toLowerCase();
    if (!/^[\d\s,.;y-]+$/.test(texto)) return false;
    const numeros = texto.split(/[\s,.;y-]+/).filter(Boolean).map(Number);
    const indices = [...new Set(numeros)];
    if (!indices.length || indices.some(n => !Number.isInteger(n) || n < 1 || n > 6)) {
        await sock.sendMessage(chatId, { text: '❌ Usa números del *1 al 6* separados por comas (ejemplo: *1,3,5*).' }, { quoted: msg });
        return true;
    }
    // Solo los números válidos del propio remitente renuevan la sesión; otros mensajes no la prolongan.
    sesion.expira = Date.now() + SESION_REEMPLAZO_TTL;
    sesionesReemplazoHeroes.set(clave, sesion);
    await sock.sendMessage(chatId, { text: '🔄 Buscando reemplazos para los héroes ' + indices.join(', ') + '…' }, { quoted: msg });
    try {
        const nuevoCuerpo = await generarReemplazosHeroes(sesion.nombre, sesion.cuerpo, indices, sesion.fuentes);
        sesion.cuerpo = nuevoCuerpo;
        sesion.expira = Date.now() + SESION_REEMPLAZO_TTL;
        sesionesReemplazoHeroes.set(clave, sesion);
        const respuesta = '🔫 *BUILD STW: ' + sesion.nombre.toUpperCase() + '*\n\n' + nuevoCuerpo + preguntaHeroes() + '\n\nApoya a un creador: *JASC13*.';
        await sock.sendMessage(chatId, { text: respuesta }, { quoted: msg });
    } catch (error) {
        console.error('[buildstw] Error recomendando reemplazos:', error?.stack || error?.message || error);
        await sock.sendMessage(chatId, { text: '⚠️ No pude generar los reemplazos en este momento. Intenta responder con los números otra vez.' }, { quoted: msg });
    }
    return true;
}

async function comandoBuildSTW(sock, chatId, msg, args) {
    const entrada = limpiar((args || []).join(' '));
    const coincidenciaEvolucion = entrada.match(/\[([^\]]+)\]\s*$/);
    const evolucion = coincidenciaEvolucion ? limpiar(coincidenciaEvolucion[1]) : null;
    const nombre = limpiar(coincidenciaEvolucion ? entrada.slice(0, coincidenciaEvolucion.index) : entrada);
    if (!nombre) {
        await sock.sendMessage(chatId, {
            text: `🔫 *BUILDS DE SALVAR AL MUNDO*

Escribe el comando seguido del nombre del arma o héroe.

Ejemplos:
• *buildstw Siegebreaker*
• *buildstw Grave Digger*
• *buildstw Pulsar 900 [malaquita]*

Si tu arma ya tiene evolución, escríbela entre corchetes para conservarla en la recomendación.

Apoya a un creador: *JASC13*.`
        }, { quoted: msg });
        return;
    }

    const clave = (nombre + (evolucion ? ' [' + evolucion.toLocaleLowerCase('es-MX') + ']' : '')).toLocaleLowerCase('es-MX');
    const guardado = cacheBuilds.get(clave);
    if (guardado && guardado.expira > Date.now()) {
        console.info('[buildstw] Resultado servido desde caché:', { nombre });
        const remitente = msg.key?.participant || msg.key?.remoteJid || chatId;
        sesionesReemplazoHeroes.set(claveSesion(chatId, remitente), {
            nombre: guardado.nombre || nombre, evolucion: guardado.evolucion || null, cuerpo: guardado.cuerpo,
            fuentes: guardado.fuentes || [], expira: Date.now() + SESION_REEMPLAZO_TTL
        });
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
            const texto = `⚠️ *BUILD STW: SIN RESULTADOS*

Objeto: *${nombre}*
Proceso donde se detuvo: *Búsqueda web*
Resultado: el buscador respondió, pero no se encontraron coincidencias de los dominios admitidos.
Coincidencias útiles: 0
Consulta realizada: Fortnite Save the World "${nombre}" weapon perks build hero

Prueba con el nombre en inglés o con el nombre exacto que aparece en el juego.

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
            resumen = await generarResumen(nombre, fuentesUtiles.length ? fuentesUtiles : resultados, evolucion);
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
        const texto = `🔫 *BUILD STW: ${nombre.toUpperCase()}*\n\n${cuerpo}${preguntaHeroes()}\n\nApoya a un creador: *JASC13*.`;
        const remitente = msg.key?.participant || msg.key?.remoteJid || chatId;
        const fuentesBuild = fuentesUtiles.length ? fuentesUtiles : resultados;
        sesionesReemplazoHeroes.set(claveSesion(chatId, remitente), {
            nombre, evolucion, cuerpo, fuentes: fuentesBuild, expira: Date.now() + SESION_REEMPLAZO_TTL
        });
        cacheBuilds.set(clave, { texto, nombre, evolucion, cuerpo, fuentes: fuentesBuild, expira: Date.now() + CACHE_TTL });
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
module.exports = { comandoBuildSTW, manejarRespuestaBuildSTW };

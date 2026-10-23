const { obtenerAlertasSTW, formatearAlertaSTW } = require('./fortnite');

const sesionesGuiaPL = new Map();
const DURACION_SESION_MS = 15 * 60 * 1000;
const PASOS = ['pl', 'meta', 'horas', 'bloqueo', 'materiales', 'escuadrones', 'zona', 'rareza', 'estilo', 'oro'];

function claveSesion(chatId, remitente) {
    return String(chatId || '') + ':' + String(remitente || '');
}

function normalizarTexto(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function textoPregunta(paso) {
    const numero = PASOS.indexOf(paso) + 1;
    const cabecera = '🎮 *GUÍA PERSONAL DE SUBIDA DE PL* · Pregunta ' + numero + '/' + PASOS.length + '\n\n';
    const preguntas = {
        pl: '¿Cuál es tu PL actual?\n\nEscribe un número del 1 al 200. Ejemplo: *62*.',
        meta: '¿A qué PL quieres llegar?\n\nEscribe el PL objetivo del 1 al 200. Ejemplo: *100*.\n\nLa guía buscará acercarte a esa meta, sin prometer un resultado que dependa de tus supervivientes y recursos.',
        horas: '¿Cuánto tiempo puedes jugar al día?\n\n1. Una hora\n2. Dos horas\n3. Tres horas',
        bloqueo: '¿Qué te está frenando más para subir PL?\n\n1. Materiales de evolución\n2. Experiencia para subir de nivel\n3. Supervivientes o líderes mejores\n4. Un poco de todo / no estoy seguro',
        materiales: '¿Qué materiales de evolución te hacen falta?\n\nPuedes elegir varios y responder, por ejemplo, *1,3*.\n\n1. Gotas de lluvia pura\n2. Ojo de la tormenta\n3. Relámpago en una botella\n4. Fragmento de tormenta\n5. Me faltan varios materiales\n6. No sé; necesito revisar qué me pide la evolución',
        escuadrones: '¿Cómo están tus escuadrones de supervivientes?\n\n1. Creo que los ocho están llenos\n2. Tengo puestos vacíos\n3. No sé cómo están configurados',
        zona: '¿Cuál es la zona de campaña más alta a la que puedes entrar actualmente?\n\n1. Bosque Pedregoso\n2. Ciudad Tablón\n3. Valle Latoso\n4. Cumbres Leñosas\n5. No sé / necesito comprobarlo',
        rareza: '¿Cómo describirías tus supervivientes y líderes?\n\n1. Muchos son comunes, poco comunes o raros\n2. Tengo una mezcla de rarezas\n3. Tengo bastantes épicos o legendarios\n4. No estoy seguro',
        estilo: '¿Cómo juegas normalmente?\n\n1. Solo\n2. Con amigos o grupo público\n3. Ambas opciones',
        oro: '¿Qué importancia quieres darle al oro frente al PL?\n\n1. Baja: solo si aparece como recompensa conveniente\n2. Equilibrada: conseguir algo de oro sin sacrificar materiales críticos\n3. Alta: también quiero priorizar oro'
    };
    return cabecera + preguntas[paso] + '\n\nEscribe *cancelar* para abandonar la guía.';
}

async function enviar(sock, chatId, msg, texto) {
    await sock.sendMessage(chatId, { text: texto }, msg ? { quoted: msg } : undefined);
}

async function iniciarGuiaPL(sock, chatId, msg, args = []) {
    const remitente = msg.key.participant || msg.key.remoteJid;
    const clave = claveSesion(chatId, remitente);
    if (Array.isArray(args) && args.some(a => normalizarTexto(a) === 'cancelar')) {
        sesionesGuiaPL.delete(clave);
        await enviar(sock, chatId, msg, '✅ Sesión de guía cancelada.');
        return;
    }

    const sesion = {
        paso: 'pl',
        respuestas: {},
        expira: Date.now() + DURACION_SESION_MS
    };
    sesionesGuiaPL.set(clave, sesion);
    await enviar(sock, chatId, msg,
        '🧭 *PREPAREMOS TU GUÍA DE STW*\n\nTe haré preguntas una por una. Responde con el número de la opción; al terminar, te indicaré qué buscar con *alerta* y *alertanov*.\n\n' +
        textoPregunta(sesion.paso));
}

function leerRespuesta(paso, texto) {
    const limpio = String(texto || '').trim().replace(/[*_~]/g, '').trim();
    if (paso === 'pl' || paso === 'meta') {
        if (!/^\d{1,3}$/.test(limpio)) return { error: 'Escribe solo un número del 1 al 200.' };
        const numero = Number(limpio);
        if (numero < 1 || numero > 200) return { error: 'El PL debe estar entre 1 y 200.' };
        return { valor: numero };
    }
    if (paso === 'materiales') {
        const partes = limpio.split(/[,;/\s]+/).filter(Boolean);
        if (!partes.length || partes.some(p => !/^[1-6]$/.test(p))) {
            return { error: 'Elige opciones del 1 al 6. Puedes combinar materiales escribiendo, por ejemplo, *1,3*.' };
        }
        const unicas = [...new Set(partes.map(Number))];
        if (unicas.includes(5) || unicas.includes(6)) {
            if (unicas.length !== 1) return { error: 'Para las opciones 5 o 6, responde únicamente *5* o *6*.' };
            return { valor: unicas[0] === 5 ? ['varios'] : ['desconocido'] };
        }
        const claves = { 1: 'lluvia', 2: 'ojo', 3: 'botella', 4: 'fragmento' };
        return { valor: unicas.map(n => claves[n]) };
    }
    const limites = {
        horas: [1, 3],
        bloqueo: [1, 4],
        escuadrones: [1, 3],
        zona: [1, 5],
        rareza: [1, 4],
        estilo: [1, 3],
        oro: [1, 3]
    };
    const rango = limites[paso];
    if (!rango || !/^\d+$/.test(limpio)) return { error: 'Responde con el número de una opción.' };
    const numero = Number(limpio);
    if (numero < rango[0] || numero > rango[1]) return { error: 'Esa opción no existe. Responde con uno de los números mostrados.' };
    return { valor: numero };
}

function recompensaTexto(item) {
    const recompensas = Array.isArray(item && item.recompensas) ? item.recompensas : [];
    const valores = recompensas.map(r => {
        if (typeof r === 'string') return r;
        if (!r || typeof r !== 'object') return '';
        return [r.nombre, r.raw, r.tipo, r.rareza, r.cantidad, r.iconClasses].filter(x => x !== undefined && x !== null && x !== '').join(' ');
    });
    return [
        valores.join(' | '),
        item && item.recompensa,
        item && item.tipoAlertaTexto,
        item && item.descripcion,
        item && item.nombre,
        item && item.material,
        item && item.tipo
    ].filter(Boolean).join(' | ');
}

function etiquetasRecompensa(item) {
    const texto = normalizarTexto(recompensaTexto(item));
    const etiquetas = { xp: false, materiales: [], superviviente: false, oro: false, rareza: [], valiosa: false };
    if (/people.?\s*xp|person.?\s*xp|survivor.?s?\s*xp|survivor experience|hero.?s?\s*xp|experience.?points|\bxp\b|experiencia.{0,25}(persona|superviviente|sobreviviente)|(?:superviviente|sobreviviente).{0,25}(?:experiencia|exp\b)/i.test(texto)) {
        etiquetas.xp = true;
    }
    if (/pure[-\s]?drop[-\s]?of[-\s]?rain|drop[-\s]?of[-\s]?rain|gotas?.{0,20}lluvia|lluvia pura/i.test(texto)) etiquetas.materiales.push('lluvia');
    if (/eye[-\s]?of[-\s]?the[-\s]?storm|ojo.{0,15}tormenta/i.test(texto)) etiquetas.materiales.push('ojo');
    if (/lightning[-\s]?in[-\s]?a[-\s]?bottle|relampago.{0,20}botella/i.test(texto)) etiquetas.materiales.push('botella');
    if (/storm[-\s]?shard|fragmento.{0,15}tormenta/i.test(texto)) etiquetas.materiales.push('fragmento');
    // Algunos raspados conservan el tipo interno aunque el nombre venga vacío o sin traducir.
    if (/evolution|material(?:es)? de evolucion/i.test(texto)) etiquetas.materiales.push('generico');
    if (/supercharger|supercargador/i.test(texto)) etiquetas.materiales.push('supercargador');
    etiquetas.materiales = [...new Set(etiquetas.materiales)];
    if (/\bsurvivors?\b|superviviente|sobreviviente|lead survivor|survivor squad/i.test(texto)) etiquetas.superviviente = true;
    if (/(?:^|[^a-z])(?:gold|oro)(?:$|[^a-z])/i.test(texto)) etiquetas.oro = true;
    if (/\blegendary\b|\blegendaria?s?\b|\blegendari[oa]s?\b/i.test(texto)) etiquetas.rareza.push('legendaria');
    if (/\bepic\b|\bepica?s?\b|\bepic[oa]s?\b/i.test(texto)) etiquetas.rareza.push('epica');
    if (/\bmythic\b|\bmitica?s?\b|\bmitic[oa]s?\b/i.test(texto)) etiquetas.rareza.push('mitica');
    etiquetas.rareza = [...new Set(etiquetas.rareza)];
    etiquetas.valiosa = etiquetas.rareza.length > 0 || /perk.?up|ventaja|superviviente|sobreviviente|schematic|esquema|hero|heroe|h[eé]roe|defender|defensor|supercharger|supercargador/i.test(texto);
    return etiquetas;
}
function zonaOrden(item) {
    const zona = normalizarTexto([item && item.zona, item && item.ubicacion].filter(Boolean).join(' '));
    if (/twine peaks|cumbres lenosas/.test(zona)) return 4;
    if (/canny valley|valle latoso/.test(zona)) return 3;
    if (/plankerton|ciudad tabl[oó]n/.test(zona)) return 2;
    if (/stonewood|bosque pedregoso/.test(zona)) return 1;
    if (/venture|aventuras/.test(zona)) return 99;
    return 0;
}

function reunirAlertas(datos) {
    const fuentes = datos && datos.fuentes || {};
    const listas = [
        datos && datos.pavos,
        datos && datos.epicas,
        datos && datos.legendarias,
        datos && datos.plAltas,
        datos && datos.materiales,
        fuentes.principal,
        fuentes.secundaria,
        fuentes.tercera
    ];
    const mapa = new Map();
    for (const lista of listas) {
        if (!Array.isArray(lista)) continue;
        for (const item of lista) {
            if (!item || typeof item !== 'object') continue;
            const plTexto = String(item.pl == null ? '' : item.pl).replace(/[^0-9]/g, '');
            const pl = plTexto ? Number(plTexto) : NaN;
            const zona = normalizarTexto(item.zona || item.ubicacion);
            const mision = normalizarTexto(item.misionOriginal || item.mision || item.nombre);
            const key = [Number.isFinite(pl) ? pl : '?', zona, mision].join('|');
            const anterior = mapa.get(key);
            if (!anterior || recompensaTexto(item).length > recompensaTexto(anterior).length) mapa.set(key, item);
        }
    }
    return [...mapa.values()];
}

function prioridadAlerta(item, respuestas) {
    const etiquetas = etiquetasRecompensa(item);
    const bloqueo = respuestas.bloqueo;
    const materialesElegidos = respuestas.materiales || [];
    const materialElegido = etiquetas.materiales.some(m => materialesElegidos.includes(m)) ||
        (materialesElegidos.includes('varios') && etiquetas.materiales.length > 0) ||
        (materialesElegidos.includes('desconocido') && etiquetas.materiales.length > 0);
    let score = 50;
    if (bloqueo === 1) {
        if (materialElegido) score = 0;
        else if (etiquetas.materiales.length) score = 1;
        else if (etiquetas.superviviente) score = 2;
        else if (etiquetas.xp) score = 3;
        else if (etiquetas.oro) score = respuestas.oro === 3 ? 1 : 4;
    } else if (bloqueo === 2) {
        if (etiquetas.xp) score = 0;
        else if (etiquetas.materiales.length) score = 1;
        else if (etiquetas.superviviente) score = 2;
        else if (etiquetas.oro) score = respuestas.oro === 3 ? 1 : 4;
    } else if (bloqueo === 3) {
        if (etiquetas.superviviente) score = 0;
        else if (etiquetas.materiales.length) score = 1;
        else if (etiquetas.xp) score = 2;
        else if (etiquetas.oro) score = respuestas.oro === 3 ? 1 : 4;
    } else {
        if (materialElegido) score = 0;
        else if (etiquetas.materiales.length) score = 1;
        else if (etiquetas.xp) score = 2;
        else if (etiquetas.superviviente) score = 2;
        else if (etiquetas.oro) score = respuestas.oro === 3 ? 1 : 3;
    }
    if (etiquetas.oro && respuestas.oro === 1 && score > 1) score += 3;
    if (etiquetas.oro && respuestas.oro === 2 && score > 1) score += 1;
    // Si dos alertas tienen prioridad similar, destacar recompensas épicas/legendarias/míticas y útiles para progresión.
    if (etiquetas.rareza.includes('mitica')) score -= 4;
    else if (etiquetas.rareza.includes('legendaria')) score -= 3;
    else if (etiquetas.rareza.includes('epica')) score -= 2;
    if (etiquetas.valiosa && score > 0) score -= 1;
    return { score, etiquetas };
}

function terminoComando(etiquetas) {
    if (etiquetas.materiales.includes('lluvia')) return 'gotas de lluvia pura';
    if (etiquetas.materiales.includes('ojo')) return 'ojo de la tormenta';
    if (etiquetas.materiales.includes('botella')) return 'relámpago en una botella';
    if (etiquetas.materiales.includes('fragmento')) return 'fragmento de tormenta';
    if (etiquetas.materiales.includes('supercargador')) return 'supercargador';
    if (etiquetas.xp) return 'experiencia de personas';
    if (etiquetas.superviviente) return 'superviviente';
    if (etiquetas.oro) return 'oro';
    return '';
}

function duracionMinutos(horas) {
    if (horas === 1) return { revision: 5, misiones: 40, mejoras: 10, oro: 5 };
    if (horas === 2) return { revision: 10, misiones: 75, mejoras: 25, oro: 10 };
    return { revision: 15, misiones: 115, mejoras: 35, oro: 15 };
}

async function generarGuia(sock, chatId, msg, sesion) {
    await enviar(sock, chatId, msg, '🔎 Estoy revisando la rotación con las alertas que usa el bot');
    let datos = null;
    let esCache = false;
    try {
        datos = await obtenerAlertasSTW(true, null, { exhaustivo: true });
    } catch (error) {
        console.error('Error actualizando alertas para guiapl:', error.stack || error.message || error);
    }

    if (!datos || datos.errorActualizacion || reunirAlertas(datos).length === 0) {
        let cache = null;
        try {
            cache = await obtenerAlertasSTW(false, null, { exhaustivo: true });
        } catch (error) {
            console.error('Error leyendo caché para guiapl:', error.stack || error.message || error);
        }
        if (cache && reunirAlertas(cache).length > 0) {
            datos = cache;
            esCache = true;
        }
    }

    const r = sesion.respuestas;
    const alertas = reunirAlertas(datos || {});
    const maxZona = r.zona === 5 ? null : r.zona;
    const elegibles = alertas.filter(item => {
        const plTexto = String(item.pl == null ? '' : item.pl).replace(/[^0-9]/g, '');
            const pl = plTexto ? Number(plTexto) : NaN;
        if (Number.isFinite(pl) && pl > r.pl + 10) return false;
        const zona = zonaOrden(item);
        if (zona === 99) return false;
        if (maxZona !== null && zona > 0 && zona > maxZona) return false;
        const tags = etiquetasRecompensa(item);
        // No recomendar héroes, esquemas, defensores o Perk-Up solo por su rareza: no suben directamente el PL.\n        return tags.xp || tags.materiales.length > 0 || tags.superviviente || tags.oro;
    });

    const ordenadas = elegibles.map(item => {
        const info = prioridadAlerta(item, r);
        const plTexto = String(item.pl == null ? '' : item.pl).replace(/[^0-9]/g, '');
            const pl = plTexto ? Number(plTexto) : NaN;
        const diferencia = Number.isFinite(pl) ? (pl > r.pl ? (pl - r.pl) * 2 : r.pl - pl) : 30;
        return { item, tags: info.etiquetas, score: info.score, diferencia };
    }).sort((a, b) => a.score - b.score || a.diferencia - b.diferencia);

    const fecha = new Date().toLocaleDateString('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const lineas = [
        '🎮 *GUÍA PERSONAL STW* · ' + fecha,
        '⚡ PL *' + r.pl + '* → meta *' + r.meta + '* · ⏱️ ' + r.horas + (r.horas === 1 ? ' h/día' : ' h/día') + ' · 🎮 ' + ({ 1: 'solo', 2: 'grupo', 3: 'solo/grupo' }[r.estilo]),
        '🛠️ Prioridad: ' + ({ 1: 'materiales', 2: 'experiencia', 3: 'supervivientes', 4: 'equilibrado' }[r.bloqueo]) + ' · 🗺️ ' + ({ 1: 'Bosque Pedregoso', 2: 'Ciudad Tablón', 3: 'Valle Latoso', 4: 'Cumbres Leñosas', 5: 'zona por confirmar' }[r.zona]),
        esCache
            ? '⚠️ _No respondió el raspado en vivo; uso datos guardados. Confirma las recompensas._'
            : (alertas.length ? '✅ _Rotación extraída por el bot._' : '⚠️ _No hay alertas utilizables extraídas; no inventaré recompensas._'),
        ''
    ];

    if (r.meta <= r.pl) {
        lineas.push('🎯 Ya alcanzaste la meta indicada. Puedes fijar una meta superior.', '');
    } else {
        lineas.push('🎯 *Plan:* acercarte a PL ' + r.meta + '. El PL final depende de tus escuadrones, niveles y evolución.', '');
    }

    lineas.push('🚨 *MEJORES ALERTAS*');
    if (!ordenadas.length) {
        lineas.push('_No encontré recompensas reconocibles para tus prioridades en la rotación extraída._');
    } else {
        const limite = Math.min(3, ordenadas.length);
        for (let i = 0; i < limite; i++) {
            const entrada = ordenadas[i];
            const item = entrada.item;
            const termino = terminoComando(entrada.tags);
            const etiqueta = entrada.tags.materiales.includes('lluvia') ? '🌧️ Gotas de lluvia'
                : entrada.tags.materiales.includes('ojo') ? '🌩️ Ojo de la tormenta'
                : entrada.tags.materiales.includes('botella') ? '⚡ Relámpago en una botella'
                : entrada.tags.materiales.includes('fragmento') ? '🔹 Fragmento de tormenta'
                : entrada.tags.materiales.includes('supercargador') ? '🔋 Supercargador'
                : entrada.tags.materiales.length ? '🧪 Material de evolución'
                : entrada.tags.xp ? '🧬 Experiencia'
                : entrada.tags.superviviente ? '🧑‍🚀 Superviviente'
                : '🪙 Oro';
            const rareza = entrada.tags.rareza.includes('mitica') ? ' · Mítica'
                : entrada.tags.rareza.includes('legendaria') ? ' · Legendaria'
                : entrada.tags.rareza.includes('epica') ? ' · Épica' : '';
            lineas.push('', (i + 1) + '. *' + etiqueta + rareza + '*');
            lineas.push(formatearAlertaSTW(item, '', false, true).trim() || ('PL ' + (item.pl ?? '?') + ' · ' + (item.zona || 'Zona no identificada')));
            if (termino) lineas.push('🔎 *alertanov ' + termino + '*');
        }
    }

    lineas.push('', '🧠 *QUÉ HACER PARA SUBIR PL*');
    if (r.escuadrones === 2 || r.escuadrones === 3 || r.rareza === 1 || r.rareza === 4) {
        lineas.push('• Completa los 8 escuadrones, revisa los líderes y mejora primero los supervivientes que conservarás.');
    } else {
        lineas.push('• Revisa líderes, personalidad y nivel de tus supervivientes antes de gastar materiales.');
    }
    if (r.bloqueo === 1 || (r.materiales || []).length) {
        const nombres = { lluvia: 'gotas de lluvia pura', ojo: 'ojo de la tormenta', botella: 'relámpago en una botella', fragmento: 'fragmento de tormenta' };
        const elegidos = (r.materiales || []).filter(m => nombres[m]).map(m => nombres[m]);
        lineas.push('• Evoluciona solo cuando tengas los requisitos; prioridad: ' + (elegidos.join(', ') || 'lo que indique la pantalla de evolución') + '.');
    } else if (r.bloqueo === 2) {
        lineas.push('• Busca experiencia de personas y úsala para subir de nivel a los supervivientes que conservarás.');
    } else {
        lineas.push('• Invierte experiencia y materiales en mejoras que aumenten tu poder; evita subir todo por igual.');
    }
    lineas.push('• En solitario, elige una misión que puedas terminar y confirma la recompensa antes de entrar.');

    const duracion = duracionMinutos(r.horas);
    lineas.push('', '🗓️ *RUTA DE ' + (r.horas * 60) + ' MIN*');
    lineas.push('1. Alertas: ' + duracion.revision + ' min · busca con *alerta* y confirma con *alertanov*.');
    lineas.push('2. Misiones prioritarias: ' + duracion.misiones + ' min · farmea el recurso que realmente te falte.');
    lineas.push('3. Escuadrones y mejoras: ' + duracion.mejoras + ' min · revisa puestos, líderes y evolución.');
    if (r.oro === 2) lineas.push('4. Reserva hasta ' + duracion.oro + ' min para oro solo si lo necesitas.');

    lineas.push('', '🔎 *COMANDOS:* *alerta gotas de lluvia pura* · *alertanov ojo de la tormenta* · *alerta superviviente*');
    lineas.push('Repite *guiapl* después del reinicio para actualizar la rotación.');
    lineas.push('', 'Apoya a un creador: *JASC13* ❤️');

    await enviar(sock, chatId, msg, lineas.join('\n'));
}

async function manejarRespuestaGuiaPL(sock, chatId, msg, remitente, textoOriginal) {
    const clave = claveSesion(chatId, remitente);
    const sesion = sesionesGuiaPL.get(clave);
    if (!sesion) return false;

    const texto = String(textoOriginal || '').trim().replace(/[*_~]/g, '').trim();
    if (/^(cancelar|cancelaguia)$/i.test(texto)) {
        sesionesGuiaPL.delete(clave);
        await enviar(sock, chatId, msg, '✅ Sesión de guía cancelada. Para comenzar otra, escribe *guiapl*.');
        return true;
    }

    if (sesion.expira <= Date.now()) {
        sesionesGuiaPL.delete(clave);
        if (/^\d+(?:[,;\s]\d+)*$/.test(texto)) {
            await enviar(sock, chatId, msg, '⌛ La sesión de la guía expiró. Escribe *guiapl* para empezar de nuevo.');
            return true;
        }
        return false;
    }

    if (/^guiapl(?:\s|$)/i.test(texto)) return false;
    if (!/^\d+(?:[,;\s]\d+)*$/.test(texto)) return false;

    const resultado = leerRespuesta(sesion.paso, texto);
    if (resultado.error) {
        await enviar(sock, chatId, msg, '⚠️ ' + resultado.error + '\n\n' + textoPregunta(sesion.paso));
        return true;
    }

    sesion.respuestas[sesion.paso] = resultado.valor;
    const indice = PASOS.indexOf(sesion.paso);
    if (indice >= PASOS.length - 1) {
        sesionesGuiaPL.delete(clave);
        await generarGuia(sock, chatId, msg, sesion);
        return true;
    }

    sesion.paso = PASOS[indice + 1];
    sesion.expira = Date.now() + DURACION_SESION_MS;
    sesionesGuiaPL.set(clave, sesion);
    await enviar(sock, chatId, msg, textoPregunta(sesion.paso));
    return true;
}

module.exports = { iniciarGuiaPL, manejarRespuestaGuiaPL };

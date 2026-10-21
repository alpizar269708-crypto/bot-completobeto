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
    if (/people\s*xp|person\s*xp|survivor.?s?\s*xp|survivor experience|hero.?s?\s*xp|experiencia.{0,25}(persona|superviviente|sobreviviente)|(?:superviviente|sobreviviente).{0,25}(?:experiencia|exp\b)/i.test(texto)) {
        etiquetas.xp = true;
    }
    if (/pure[-\s]?drop[-\s]?of[-\s]?rain|drop[-\s]?of[-\s]?rain|gotas?.{0,20}lluvia|lluvia pura/i.test(texto)) etiquetas.materiales.push('lluvia');
    if (/eye[-\s]?of[-\s]?the[-\s]?storm|ojo.{0,15}tormenta/i.test(texto)) etiquetas.materiales.push('ojo');
    if (/lightning[-\s]?in[-\s]?a[-\s]?bottle|relampago.{0,20}botella/i.test(texto)) etiquetas.materiales.push('botella');
    if (/storm[-\s]?shard|fragmento.{0,15}tormenta/i.test(texto)) etiquetas.materiales.push('fragmento');
    if (/evolution(?: material)?|material(?:es)? de evolucion/i.test(texto)) etiquetas.materiales.push('generico');
    etiquetas.materiales = [...new Set(etiquetas.materiales)];
    if (/\bsurvivors?\b|superviviente|sobreviviente|lead survivor|survivor squad/i.test(texto)) etiquetas.superviviente = true;
    if (/(?:^|[^a-z])(?:gold|oro)(?:$|[^a-z])/i.test(texto)) etiquetas.oro = true;
    if (/\blegendary\b|\blegendaria?s?\b|\blegendari[oa]s?\b/i.test(texto)) etiquetas.rareza.push('legendaria');
    if (/\bepic\b|\bepica?s?\b|\bepic[oa]s?\b/i.test(texto)) etiquetas.rareza.push('epica');
    if (/\bmythic\b|\bmitica?s?\b|\bmitic[oa]s?\b/i.test(texto)) etiquetas.rareza.push('mitica');
    etiquetas.rareza = [...new Set(etiquetas.rareza)];
    etiquetas.valiosa = etiquetas.rareza.length > 0 || /perk.?up|ventaja|superviviente|sobreviviente|schematic|esquema|hero|heroe|h[eé]roe|defender|defensor/i.test(texto);
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
        return tags.xp || tags.materiales.length > 0 || tags.superviviente || tags.oro || tags.valiosa;
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
        '🎮 *GUÍA PERSONAL STW*',
        '📅 _Rotación revisada: ' + fecha + '_',
        '',
        '⚡ *PL actual:* ' + r.pl + '  →  🎯 *Meta:* ' + r.meta,
        '⏱️ *Tiempo diario:* ' + r.horas + (r.horas === 1 ? ' hora' : ' horas') + ' · 🎮 *Estilo:* ' + ({ 1: 'solo', 2: 'grupo', 3: 'solo o grupo' }[r.estilo]),
        '🛠️ *Principal bloqueo:* ' + ({ 1: 'materiales de evolución', 2: 'experiencia', 3: 'supervivientes/líderes', 4: 'equilibrado' }[r.bloqueo]),
        '🧑‍🚀 *Escuadrones:* ' + ({ 1: 'probablemente completos', 2: 'hay puestos vacíos', 3: 'por revisar' }[r.escuadrones]),
        '🗺️ *Zona más alta que indicaste:* ' + ({ 1: 'Bosque Pedregoso', 2: 'Ciudad Tablón', 3: 'Valle Latoso', 4: 'Cumbres Leñosas', 5: 'no confirmada' }[r.zona]),
        '🧑‍🚀 *Supervivientes:* ' + ({ 1: 'predominan rarezas bajas', 2: 'mezcla de rarezas', 3: 'bastantes épicos/legendarios', 4: 'por revisar' }[r.rareza]),
        '',
        esCache
            ? '⚠️ _El raspado en vivo no respondió; esta guía usa la última caché guardada. Confirma los resultados con alerta/alertanov antes de entrar._'
            : (alertas.length ? '✅ _Guía basada en las alertas que acaba de extraer el bot._' : '⚠️ _El bot no tiene alertas extraídas que pueda usar ahora. No inventaré misiones; consulta los comandos indicados al final._'),
        ''
    ];

    if (r.meta <= r.pl) {
        lineas.push('🎯 Ya estás en el PL objetivo que indicaste. Elige una meta superior o usa las alertas para preparar la siguiente evolución.', '');
    } else {
        lineas.push('📈 *Objetivo:* acercarte todo lo posible a PL ' + r.meta + '. El salto depende de los niveles, rarezas, líderes, personalidades y materiales que tengas; no se puede garantizar una cifra solo con alertas.', '');
    }

    lineas.push('🚨 *ALERTAS QUE MEJOR ENCAJAN CON TU PERFIL*', '');
    if (!ordenadas.length) {
        lineas.push('_No encontré entre las alertas extraídas una recompensa reconocible para experiencia, materiales de evolución, supervivientes u oro dentro de tu rango/zona indicada._', '');
    } else {
        const limite = Math.min(8, ordenadas.length);
        for (let i = 0; i < limite; i++) {
            const entrada = ordenadas[i];
            const item = entrada.item;
            const termino = terminoComando(entrada.tags);
            const etiqueta = entrada.tags.materiales.length
                ? (entrada.tags.materiales.includes('lluvia') ? '🌧️ Gotas de lluvia'
                    : entrada.tags.materiales.includes('ojo') ? '🌩️ Ojo de la tormenta'
                    : entrada.tags.materiales.includes('botella') ? '⚡ Relámpago en una botella'
                    : entrada.tags.materiales.includes('fragmento') ? '🔹 Fragmento de tormenta'
                    : '🧪 Material de evolución')
                : entrada.tags.xp ? '🧬 Experiencia'
                : entrada.tags.superviviente ? '🧑‍🚀 Superviviente'
                : entrada.tags.oro ? '🪙 Oro'
                : '💎 Recompensa especial';
            const marcaRareza = entrada.tags.rareza.includes('mitica') ? ' · 🌟 MÍTICA' : entrada.tags.rareza.includes('legendaria') ? ' · 🟠 LEGENDARIA' : entrada.tags.rareza.includes('epica') ? ' · 🟣 ÉPICA' : '';
            lineas.push((i + 1) + '. *' + etiqueta + marcaRareza + '*');
            const detalle = formatearAlertaSTW(item, '', false, true).trim();
            lineas.push(detalle || ('PL ' + (item.pl == null ? '?' : item.pl) + ' · ' + (item.zona || 'Zona no identificada')));
            if (termino) lineas.push('🔎 Para revisar los requisitos: *alertanov ' + termino + '*');
            lineas.push('');
        }
        if (ordenadas.length > limite) lineas.push('_Hay más coincidencias en las alertas guardadas; busca el material concreto con alerta o alertanov._', '');
    }

    const duracion = duracionMinutos(r.horas);
    lineas.push('🧠 *DIAGNÓSTICO Y ORDEN DE MEJORAS*', '');
    if (r.escuadrones !== 1 || r.rareza === 1 || r.rareza === 4) {
        lineas.push('• Primero revisa los ocho escuadrones: líder adecuado, puestos llenos, personalidad compatible y supervivientes mejorados. Esto puede aumentar tu PL sin depender de una recompensa nueva.');
    } else {
        lineas.push('• Tus escuadrones parecen completos; revisa líderes, personalidad y nivel antes de gastar recursos en sustituciones pequeñas.');
    }
    if (r.bloqueo === 1 || (r.materiales || []).length) {
        const nombresMateriales = { lluvia: 'gotas de lluvia pura', ojo: 'ojo de la tormenta', botella: 'relámpago en una botella', fragmento: 'fragmento de tormenta' };
        const elegidos = (r.materiales || []).filter(m => nombresMateriales[m]).map(m => nombresMateriales[m]);
        lineas.push('• Materiales prioritarios: ' + (elegidos.length ? elegidos.join(', ') : 'los que indique la siguiente evolución en el menú de supervivientes') + '. Comprueba también experiencia y nivel de estrella antes de farmear.');
    }
    lineas.push('• El filtro favorece recompensas de evolución y, cuando aparecen en los datos, objetos épicos, legendarios o míticos útiles. La rareza se muestra solo si el raspado la identifica; no se deduce una recompensa ausente.', '');
    lineas.push('🗓️ *RUTA DIARIA DE ' + (r.horas * 60) + ' MINUTOS*', '');
    lineas.push('1. *Revisar alertas (' + duracion.revision + ' min):* usa *alerta* con el material que te falte. Después consulta esa misma búsqueda con *alertanov* para ver detalles y requisitos.');
    if (r.bloqueo === 1) {
        lineas.push('2. *Materiales (' + duracion.misiones + ' min):* prioriza las alertas reconocidas del material seleccionado. No gastes un material si aún no tienes la experiencia o los demás requisitos para evolucionar.');
    } else if (r.bloqueo === 2) {
        lineas.push('2. *Experiencia (' + duracion.misiones + ' min):* busca con *alerta experiencia de personas* y *alertanov experiencia de personas*; el bot solo recomendará recompensas que su raspado haya identificado.');
    } else if (r.bloqueo === 3) {
        lineas.push('2. *Supervivientes (' + duracion.misiones + ' min):* usa *alerta superviviente* y *alertanov superviviente legendario*. Cambia un puesto solo si el reemplazo mejora el poder total del escuadrón.');
    } else {
        lineas.push('2. *Farmeo principal (' + duracion.misiones + ' min):* prioriza las alertas de materiales que te falten; después experiencia y supervivientes que mejoren los escuadrones.');
    }
    lineas.push('3. *Mejoras (' + duracion.mejoras + ' min):* entra a Comando → Supervivientes → Administrar. Revisa los ocho escuadrones, llena puestos vacíos, corrige líderes y personalidades; luego evoluciona solo los supervivientes que vayas a conservar.');
    if (r.escuadrones === 2) lineas.push('📌 Como tienes puestos vacíos, llénalos primero con los mejores supervivientes que ya tengas: los huecos sin cubrir desperdician poder disponible.');
    else if (r.escuadrones === 3) lineas.push('📌 Como no tienes claro cómo están los escuadrones, antes de gastar recursos revisa los ocho: líder correcto, puestos llenos, rareza, nivel y personalidad.');
    if (r.rareza === 1) lineas.push('🧑‍🚀 Como predominan rarezas bajas, cualquier sustitución por un superviviente de mayor rareza que encaje bien puede ayudar; no evoluciones a todos indiscriminadamente.');
    else if (r.rareza === 2) lineas.push('🧑‍🚀 Con una mezcla de rarezas, conserva los supervivientes que aporten más poder y reemplaza solo cuando el nuevo suponga una mejora real.');
    else if (r.rareza === 3) lineas.push('🧑‍🚀 Si ya tienes bastantes épicos/legendarios, céntrate en niveles, evolución, líderes y personalidad compatible antes de gastar recursos en más supervivientes.');
    if (r.estilo === 1) lineas.push('🎮 Juegas solo: entre dos alertas de valor parecido, empieza por la de menor PL que puedas terminar de forma constante; evita repetir una misión difícil solo por una recompensa atractiva.');
    if (r.oro === 1) {
        lineas.push('4. *Oro (' + duracion.oro + ' min):* no reserves una sesión exclusiva; hazlo solo si una alerta útil también da oro o si ya tienes los materiales prioritarios.');
    } else if (r.oro === 2) {
        lineas.push('4. *Oro (' + duracion.oro + ' min):* separa este tiempo para una alerta de oro si aparece en los datos del bot; si no aparece, usa esos minutos en el material más escaso.');
    } else {
        lineas.push('4. *Oro (' + duracion.oro + ' min):* priorízalo cuando el bot detecte una recompensa de oro, sin gastar la sesión completa si tienes una evolución bloqueada.');
    }

    lineas.push('', '🔁 *CÓMO ACTUALIZAR LA GUÍA AL CAMBIAR LA ROTACIÓN*');
    lineas.push('Vuelve a enviar *guiapl* después del reinicio de alertas. La guía intentará usar la rotación recién raspada; si solo tiene datos guardados, lo avisará. El plan se recalcula con tu PL, meta, zona, tiempo, bloqueo, materiales y preferencia por oro.');
    lineas.push('Para consultas rápidas, usa *alerta gotas de lluvia pura*, *alertanov ojo de la tormenta*, *alertanov relámpago en una botella* o *alerta superviviente*. Cambia el término por el recurso que te falte. No se sugerirán recompensas que el raspado del bot no haya detectado.');
    lineas.push('', '💡 *Regla clave:* antes de cada misión, confirma el PL, la recompensa y los requisitos con *alertanov*. Una recompensa solo cuenta como útil si puedes entrar a la misión y completarla razonablemente solo.');
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

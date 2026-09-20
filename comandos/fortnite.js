const cron = require('node-cron');
const { Config } = require('../database/modelos');

function obtenerFechaActual() {
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

// 🔒 FUNCIÓN DE SEGURIDAD PARA COMANDOS ADMINISTRATIVOS
async function esAdminValido(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: `❌ Este comando solo se puede usar en grupos.` }, { quoted: msg });
        return false;
    }
    if (msg.key.fromMe) return true; 
    
    const remitente = msg.key.participant;
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participante = groupMetadata.participants.find(p => p.id === remitente);
        if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
            return true;
        }
    } catch (e) {}

    await sock.sendMessage(chatId, { text: `❌ Comando exclusivo para administradores del grupo.` }, { quoted: msg });
    return false;
}

// 🌐 EXTRACTOR CON LA ESTRUCTURA ORIGINAL
async function obtenerAlertasSTW() {
    let pavos = [];
    let legendarias = []; 

    // 1. Cargar manuales
    try {
        let manualPavos = await Config.findOne({ clave: 'stw_pavos_activos' });
        if (manualPavos && manualPavos.valor) pavos = pavos.concat(JSON.parse(manualPavos.valor));

        let manualLegendarias = await Config.findOne({ clave: 'stw_legendarias_activas' });
        if (manualLegendarias && manualLegendarias.valor) legendarias = legendarias.concat(JSON.parse(manualLegendarias.valor));
    } catch (e) {}

    // 2. Extractor Web
    try {
        let respuesta = await fetch('https://freethevbucks.com/timed-missions/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        let html = await respuesta.text();
        html = html.replace(/<(head|script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, '');
        html = html.replace(/alt="([^"]+)"/gi, ' $1 ').replace(/title="([^"]+)"/gi, ' $1 ');

        let textoPlano = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();

        const regexPavos = /(25|30|35|40|50)([^0-9]{1,30}?)(\d{1,3})([^a-z]{1,20}?)([a-z0-9\s\-]+?)\s+in\s+(twine peaks|canny valley|plankerton|stonewood)/gi;
        
        const misionesNombres = [
            { en: 'ride the lightning', es: 'Monta el relámpago' },
            { en: 'fight the storm', es: 'Lucha contra la tormenta' },
            { en: 'category 1', es: 'Tormenta cat. 1' },
            { en: 'category 2', es: 'Tormenta cat. 2' },
            { en: 'category 3', es: 'Tormenta cat. 3' },
            { en: 'category 4', es: 'Tormenta cat. 4' },
            { en: 'evacuate the shelter', es: 'Evacua el refugio' },
            { en: 'repair the shelter', es: 'Repara el refugio' },
            { en: 'deliver the bomb', es: 'Entrega el pedido' },
            { en: 'retrieve the data', es: 'Recupera los datos' },
            { en: 'rescue the survivors', es: 'Rescata supervivientes' },
            { en: 'test the suit', es: 'Prueba el traje' },
            { en: 'eliminate and collect', es: 'Elimina y recolecta' },
            { en: 'resupply', es: 'Reabastecimiento' },
            { en: 'build the radar', es: 'Construye la red de radar' }
        ];

        let misionesGuardadas = new Set();

        // Extraer PaVos (Idéntico a tu captura exitosa)
        let match;
        while ((match = regexPavos.exec(textoPlano)) !== null) {
            let cantidad = parseInt(match[1]);
            let pl = match[3];
            let misionCruda = match[5].trim();
            let zonaCruda = match[6].trim();

            let zonaEs = zonaCruda === 'twine peaks' ? 'Cumbres Leñosas' : zonaCruda === 'canny valley' ? 'Valle Latoso' : zonaCruda === 'plankerton' ? 'Valle Plácido' : 'Bosque Pedregoso';
            let misionEs = '';
            for (let m of misionesNombres) {
                if (misionCruda.includes(m.en)) { misionEs = m.es; break; }
            }

            if (!misionEs || parseInt(pl) > 160) continue;

            let idUnico = `pavo-${zonaEs}-${cantidad}-${pl}-${misionEs}`;
            if (!misionesGuardadas.has(idUnico)) {
                misionesGuardadas.add(idUnico);
                pavos.push({ zona: zonaEs, cantidad: cantidad, pl: pl, mision: misionEs, tipo: 'Automático' });
            }
        }

        // Extraer Legendarias y Épicas adaptado
        let filas = html.split(/<\/tr>|<\/li>|<\/div>/i);
        for (let fila of filas) {
            let txt = fila.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

            let rarezaMatch = txt.match(/\b(mythic|legendary|epic)\b/);
            if (!rarezaMatch) continue;

            let zonaMatch = txt.match(/\b(twine peaks|canny valley|plankerton|stonewood)\b/);
            if (!zonaMatch) continue;

            let misionEs = '';
            for (let m of misionesNombres) {
                if (txt.includes(m.en)) { misionEs = m.es; break; }
            }
            if (!misionEs) continue;

            let numeros = txt.match(/\b\d{1,3}\b/g) || [];
            let pl = '??';
            for (let num of numeros) {
                let n = parseInt(num);
                if (n > 0 && n <= 160) { pl = n.toString(); break; }
            }

            let zonaEs = zonaMatch[1] === 'twine peaks' ? 'Cumbres Leñosas' : zonaMatch[1] === 'canny valley' ? 'Valle Latoso' : zonaMatch[1] === 'plankerton' ? 'Valle Plácido' : 'Bosque Pedregoso';
            
            let colorEmoji = rarezaMatch[1] === 'mythic' ? '🟡 Mítico' : rarezaMatch[1] === 'legendary' ? '🟠 Legendario' : '🟣 Épico';
            
            let itemDesc = txt.includes('survivor') ? 'Sobreviviente' :
                           txt.includes('defender') ? 'Defensor' :
                           txt.includes('hero') ? 'Héroe' :
                           txt.includes('schematic') ? 'Esquema' :
                           txt.includes('perk-up') ? 'Perk-UP' : 'Recompensa';

            let recompensaFinal = `${colorEmoji} | ${itemDesc}`;

            let idUnico = `rec-${zonaEs}-${recompensaFinal}-${pl}-${misionEs}`;
            if (!misionesGuardadas.has(idUnico)) {
                misionesGuardadas.add(idUnico);
                legendarias.push({ zona: zonaEs, recompensa: recompensaFinal, pl: pl, mision: misionEs });
            }
        }
    } catch (e) {}

    return { pavos, legendarias };
}

// 📱 FORMATEADOR CON EL DISEÑO ORIGINAL EXACTO
async function alertasSTW(sock, chatId, msg, categoria = 'todas') {
    const datos = await obtenerAlertasSTW();
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n`;

    if (categoria === 'pavos' || categoria === 'todas') {
        texto += `🎮 *ALERTAS DE PAVOS*\n`;
        if (datos.pavos.length === 0) {
            texto += `_No hay alertas de pavos hoy._\n\n`;
        } else {
            let totalPavos = 0;
            datos.pavos.forEach(p => {
                totalPavos += p.cantidad;
                texto += `📍 *${p.zona}*\n🪙 *PaVos:* ${p.cantidad}\n⚡ *PL:* ${p.pl}\n🎯 *Misión:* ${p.mision} ${p.tipo ? `_(${p.tipo})_` : ''}\n\n`;
            });
            texto += `💰 *Total del día:* ${totalPavos} paVos\n\n`;
        }
    }

    if (categoria === 'legendarias' || categoria === 'todas' || categoria === 'importantes') {
        texto += `🌟 *ALERTAS ÉPICAS Y LEGENDARIAS*\n`;
        if (datos.legendarias.length === 0) {
            texto += `_No hay alertas legendarias registradas hoy._\n\n`;
        } else {
            datos.legendarias.forEach(L => {
                texto += `📍 *${L.zona}*\n🎁 *Da:* ${L.recompensa}\n⚡ *PL:* ${L.pl}\n🎯 *Misión:* ${L.mision}\n\n`;
            });
        }
    }

    if (categoria !== 'pavos' && categoria !== 'legendarias' && categoria !== 'todas' && categoria !== 'importantes') {
        texto = `🤖 *CONSULTAS DE SALVAR EL MUNDO*\n\nEscribe *!pavos* o *!legendarias* para ver las misiones activas.\n\n`;
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

// ⚙️ COMANDOS MANUALES Y CRON (Intocables)
async function comandoSetPavos(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    const partes = args.join(' ').split('|').map(p => p.trim());
    if (partes.length < 4) return await sock.sendMessage(chatId, { text: `❌ Uso: !setpavos Zona | Misión | Cantidad | PL` }, { quoted: msg });
    let actual = await Config.findOne({ clave: 'stw_pavos_activos' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    lista.push({ zona: partes[0], mision: partes[1], cantidad: parseInt(partes[2]) || 30, pl: partes[3] || '??', tipo: 'Manual' });
    await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ PaVos manuales agregados.` }, { quoted: msg });
}

async function comandoSetLegendarias(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    const partes = args.join(' ').split('|').map(p => p.trim());
    if (partes.length < 4) return await sock.sendMessage(chatId, { text: `❌ Uso: !setlegendarias Zona | Misión | Recompensa | PL` }, { quoted: msg });
    let actual = await Config.findOne({ clave: 'stw_legendarias_activas' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    lista.push({ zona: partes[0], mision: partes[1], recompensa: partes[2], pl: partes[3] || '??' });
    await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ Recompensa manual agregada.` }, { quoted: msg });
}

async function comandoResetPavos(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'stw_pavos_activos' });
    await Config.findOneAndDelete({ clave: 'stw_legendarias_activas' });
    await sock.sendMessage(chatId, { text: `🗑️ Alertas manuales restablecidas.` }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg) {
    await sock.sendMessage(chatId, { text: `🤖 Escribe *!pavos* o *!legendarias*.` }, { quoted: msg });
}

function iniciarCronAlertasDiarias(sock) {
    cron.schedule('5 18 * * *', async () => {
        try {
            const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
            if (!configChat || !configChat.valor) return;
            const datos = await obtenerAlertasSTW();
            let total = datos.pavos.reduce((acc, p) => acc + p.cantidad, 0);

            let mensajeAuto = `🎮 *REPORTE DIARIO STW (6:05 PM)*\n\n`;
            if (datos.pavos.length > 0) {
                datos.pavos.forEach(p => {
                    mensajeAuto += `📍 *${p.zona}* | 🪙 ${p.cantidad} PaVos | ⚡ PL: ${p.pl}\n`;
                });
                mensajeAuto += `\n💰 *Total del día:* ${total} paVos\n\n`;
            }
            if (datos.legendarias.length > 0) {
                mensajeAuto += `🌟 *ÉPICAS Y LEGENDARIAS*\n`;
                datos.legendarias.forEach(L => {
                    mensajeAuto += `📍 *${L.zona}* | 🎁 ${L.recompensa} | ⚡ PL: ${L.pl}\n`;
                });
            }
            mensajeAuto += `\nSupport-a-Creator: *JASC13* ❤️`;
            await sock.sendMessage(configChat.valor, { text: mensajeAuto });
        } catch (error) {}
    }, { scheduled: true, timezone: "America/Mexico_City" });
}

async function activarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndUpdate({ clave: 'chat_alertas_diarias' }, { valor: chatId }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ *Grupo vinculado.* Reportes automáticos a las 6:05 PM configurados.` }, { quoted: msg });
}

async function desactivarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'chat_alertas_diarias' });
    await sock.sendMessage(chatId, { text: `🔕 *Alertas desactivadas en este grupo.*` }, { quoted: msg });
}

// ======================================================================
// 🆕 MISIONES DETALLADAS POR RAREZA (comandos: legendarias / stw)
// Extractor independiente del anterior: no toca pavos ni legendarias
// manuales, solo agrega "!legendarias" y "!stw" con recompensas Epic
// y Legendary filtradas, sin imágenes, usando el mismo fetch nativo
// que ya usa el resto del archivo.
// ======================================================================

const ZONAS_STW = ['STONEWOOD', 'PLANKERTON', 'CANNY VALLEY', 'TWINE PEAKS'];
const ZONA_STW_INFO = {
    'STONEWOOD': { nombre: 'STONEWOOD', emoji: '🟢' },
    'PLANKERTON': { nombre: 'PLANKERTON', emoji: '🔵' },
    'CANNY VALLEY': { nombre: 'CANNY VALLEY', emoji: '🟠' },
    'TWINE PEAKS': { nombre: 'TWINE PEAKS', emoji: '🟣' }
};
function capitalizarRarezaSTW(palabra) {
    return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
}

// Divide el texto de recompensas de UNA misión (separadas por comas) en
// objetos { rareza, texto }. Ignora recompensas sin rareza reconocible
// (materiales, V-Bucks, tickets, etc.) ya que esos comandos solo deben
// mostrar Epic/Legendary.
function parsearRecompensasSTW(textoCrudo) {
    const recompensas = [];
    const trozos = textoCrudo.split(',');

    for (let trozo of trozos) {
        trozo = trozo.trim();
        if (!trozo) continue;
        if (trozo.length > 120) trozo = trozo.slice(0, 120); // protección extra

        // Forma "Rareza Nombre (xCantidad)" -> ej. "Epic PERK-UP! (x75)"
        let m = trozo.match(/^(Legendary|Epic|Rare|Uncommon|Common|Mythic)\s+(.+?)\s*\(x(\d+)\)\s*$/i);
        if (m) {
            const rareza = capitalizarRarezaSTW(m[1]);
            recompensas.push({ rareza, texto: `${rareza} ${m[2].trim()} x${m[3]}` });
            continue;
        }

        // Forma "Nombre (Rareza)" -> ej. "Survivor (Legendary)"
        // (se toleran espacios extra dentro del paréntesis, p.ej. "( Legendary )",
        // que quedan al eliminar las etiquetas usadas por el sitio para resaltarla)
        m = trozo.match(/^(.+?)\s*\(\s*(Legendary|Epic|Rare|Uncommon|Common|Mythic)\s*\)\s*$/i);
        if (m) {
            const rareza = capitalizarRarezaSTW(m[2]);
            recompensas.push({ rareza, texto: `${m[1].trim()} (${rareza})` });
            continue;
        }

        // Recompensa sin rareza definida (Pure Drop of Rain, RE-PERK!, V-Bucks, Tickets, etc.)
        // -> no cuenta para los filtros Epic/Legendary, se ignora sin romper el análisis.
    }

    return recompensas;
}

// Analiza el HTML crudo de la página y devuelve la lista de misiones con
// su zona, PL, nombre y recompensas. No depende de nombres de misión
// fijos ni de posiciones de texto: usa el atributo alt de cada imagen de
// misión como marcador de inicio de fila, y busca los encabezados de zona
// (STONEWOOD/PLANKERTON/CANNY VALLEY/TWINE PEAKS en mayúsculas) como
// separadores, sin importar qué etiqueta HTML los envuelva.
function parsearMisionesSTW(html) {
    let limpio = html.replace(/<(head|script|style|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

    // Convertimos cada <img ...> en un marcador de fila usando su alt,
    // en vez de depender de una lista cerrada de nombres de misión.
    limpio = limpio.replace(/<img\b[^>]*>/gi, (imgTag) => {
        const altMatch = imgTag.match(/\balt\s*=\s*"([^"]*)"/i) || imgTag.match(/\balt\s*=\s*'([^']*)'/i);
        const alt = altMatch ? altMatch[1].trim() : '';
        return alt ? `@@FILA_STW@@${alt}@@FIN_ALT_STW@@` : ' ';
    });

    let texto = limpio
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ');

    const misiones = [];
    const vistos = new Set();
    const partes = texto.split('@@FILA_STW@@');

    let zonaActual = null;

    for (let i = 1; i < partes.length; i++) {
        const bloque = partes[i];
        const finAlt = bloque.indexOf('@@FIN_ALT_STW@@');
        if (finAlt === -1) continue;

        const nombreMision = bloque.slice(0, finAlt).trim();
        const resto = bloque.slice(finAlt + '@@FIN_ALT_STW@@'.length);

        const zonaMatch = resto.match(/\b(STONEWOOD|PLANKERTON|CANNY VALLEY|TWINE PEAKS)\b/);
        let restoMision = resto;
        let zonaSiguiente = null;
        if (zonaMatch) {
            restoMision = resto.slice(0, zonaMatch.index);
            zonaSiguiente = zonaMatch[1];
        }

        if (zonaActual) {
            const plMatch = restoMision.match(/\b(\d{1,3})\b/);
            if (plMatch) {
                const pl = parseInt(plMatch[1], 10);
                let textoRecompensas = restoMision.slice(plMatch.index + plMatch[0].length);
                textoRecompensas = textoRecompensas.slice(0, 300).trim();

                const recompensas = parsearRecompensasSTW(textoRecompensas);
                if (recompensas.length > 0 && pl > 0 && pl <= 300) {
                    const idUnico = `${zonaActual}|${pl}|${nombreMision}|${textoRecompensas}`;
                    if (!vistos.has(idUnico)) {
                        vistos.add(idUnico);
                        misiones.push({ zona: zonaActual, pl, mision: nombreMision, recompensas });
                    }
                }
            }
        }

        if (zonaSiguiente) zonaActual = zonaSiguiente;
    }

    return misiones;
}

// Descarga y analiza las misiones actuales desde freethevbucks.com.
// Lanza un error si la conexión falla; quien la use debe capturarlo.
async function extraerMisionesDetalladasSTW() {
    const respuesta = await fetch('https://freethevbucks.com/timed-missions/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const html = await respuesta.text();
    return parsearMisionesSTW(html);
}

// Arma el mensaje final de texto (sin imágenes) para "legendarias" o "stw".
// - soloLegendary=true  -> solo misiones con al menos una recompensa Legendary
// - soloLegendary=false -> misiones con recompensas Epic o Legendary
// En ambos casos, únicamente se muestran las recompensas Epic/Legendary de
// cada misión (las Common/Uncommon/Rare se eliminan del mensaje).
function formatearMisionesSTW(misiones, { soloLegendary, titulo, tituloEmoji, mensajeVacio }) {
    const misionesFiltradas = misiones
        .map(m => {
            const recompensasMostrables = m.recompensas.filter(r => r.rareza === 'Epic' || r.rareza === 'Legendary');
            const tieneLegendary = m.recompensas.some(r => r.rareza === 'Legendary');
            const califica = soloLegendary ? tieneLegendary : recompensasMostrables.length > 0;
            return califica ? { ...m, recompensasMostrables } : null;
        })
        .filter(Boolean);

    if (misionesFiltradas.length === 0) return mensajeVacio;

    let texto = `${tituloEmoji} *${titulo}*\n\n`;

    for (const zona of ZONAS_STW) {
        const misionesZona = misionesFiltradas.filter(m => m.zona === zona);
        if (misionesZona.length === 0) continue;

        const info = ZONA_STW_INFO[zona];
        texto += `${info.emoji} *${info.nombre}*\n\n`;

        for (const m of misionesZona) {
            texto += `🔸 PL ${m.pl}\n`;
            if (m.mision) texto += `📍 ${m.mision}\n`;
            for (const r of m.recompensasMostrables) {
                texto += `🎯 ${r.texto}\n`;
            }
            texto += `\n`;
        }
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    return texto;
}

// 🏆 Comando: !legendarias -> solo misiones con al menos una recompensa Legendary
async function comandoLegendarias(sock, chatId, msg) {
    try {
        const misiones = await extraerMisionesDetalladasSTW();
        const texto = formatearMisionesSTW(misiones, {
            soloLegendary: true,
            titulo: 'MISIONES LEGENDARIAS',
            tituloEmoji: '🏆',
            mensajeVacio: '😕 No hay misiones con recompensas *Legendary* disponibles en este momento.'
        });
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '⚠️ No se pudo obtener la información de las misiones en este momento. Intenta de nuevo más tarde.' }, { quoted: msg });
    }
}

// 🌩️ Comando: !stw -> misiones con recompensas Epic o Legendary
async function comandoSTW(sock, chatId, msg) {
    try {
        const misiones = await extraerMisionesDetalladasSTW();
        const texto = formatearMisionesSTW(misiones, {
            soloLegendary: false,
            titulo: 'MISIONES STW',
            tituloEmoji: '🌩️',
            mensajeVacio: '😕 No hay misiones con recompensas *Epic* o *Legendary* disponibles en este momento.'
        });
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '⚠️ No se pudo obtener la información de las misiones en este momento. Intenta de nuevo más tarde.' }, { quoted: msg });
    }
}

module.exports = { 
    obtenerAlertasSTW, alertasSTW, comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias, 
    comandoSetPavos, comandoSetLegendarias, comandoResetPavos,
    comandoLegendarias, comandoSTW
};
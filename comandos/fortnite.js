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

// 🌐 Extractor de Salvar el Mundo (Detecta PaVos, Épicas, Legendarias y Míticas)
async function obtenerAlertasSTW() {
    let pavos = [];
    let legendarias = []; 

    // 1. CARGAR ALERTAS MANUALES DESDE LA BASE DE DATOS
    try {
        let manualPavos = await Config.findOne({ clave: 'stw_pavos_activos' });
        if (manualPavos && manualPavos.valor) {
            pavos = pavos.concat(JSON.parse(manualPavos.valor));
        }

        let manualLegendarias = await Config.findOne({ clave: 'stw_legendarias_activas' });
        if (manualLegendarias && manualLegendarias.valor) {
            legendarias = legendarias.concat(JSON.parse(manualLegendarias.valor));
        }
    } catch (e) {
        console.error("Error al leer manuales:", e);
    }

    // 2. SCRAPER AUTOMÁTICO
    try {
        let respuesta = await fetch('https://freethevbucks.com/timed-missions/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        let html = await respuesta.text();
        html = html.replace(/<(head|script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, '');
        
        // 🔥 EL TRUCO: Extraemos el nombre de las recompensas ocultas en las imágenes antes de borrar el HTML
        html = html.replace(/alt="([^"]+)"/gi, ' $1 ').replace(/title="([^"]+)"/gi, ' $1 ');

        // Ahora sí limpiamos el código web
        let textoPlano = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();

        // Regex Original de PaVos
        const regexPavos = /(25|30|35|40|50)([^0-9]{1,30}?)(\d{1,3})([^a-z]{1,20}?)([a-z0-9\s\-]+?)\s+in\s+(twine peaks|canny valley|plankerton|stonewood)/gi;
        
        // Regex Nuevo para Recompensas (Míticas, Legendarias, Épicas)
        const regexDestacadas = /(mythic|legendary|epic)\s+([a-z\s\-]{2,30}?)([^0-9]{1,30}?)(\d{1,3})([^a-z]{1,20}?)([a-z0-9\s\-]+?)\s+in\s+(twine peaks|canny valley|plankerton|stonewood)/gi;

        let misionesGuardadas = new Set();

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

        // --- EXTRACCIÓN DE PAVOS ---
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

        // --- EXTRACCIÓN DE RECOMPENSAS ÉPICAS Y LEGENDARIAS ---
        let matchDestacada;
        while ((matchDestacada = regexDestacadas.exec(textoPlano)) !== null) {
            let rarezaCruda = matchDestacada[1]; // mythic, legendary, epic
            let itemCrudo = matchDestacada[2].trim(); // survivor, defender, perk-up, etc.
            let pl = matchDestacada[4];
            let misionCruda = matchDestacada[6].trim();
            let zonaCruda = matchDestacada[7].trim();

            let zonaEs = zonaCruda === 'twine peaks' ? 'Cumbres Leñosas' : zonaCruda === 'canny valley' ? 'Valle Latoso' : zonaCruda === 'plankerton' ? 'Valle Plácido' : 'Bosque Pedregoso';
            let misionEs = '';
            for (let m of misionesNombres) {
                if (misionCruda.includes(m.en)) { misionEs = m.es; break; }
            }

            if (!misionEs || parseInt(pl) > 160) continue;

            // Traducir y formatear el item
            let traduccion = itemCrudo
                .replace(/lead survivor/g, 'Líder Sobreviviente')
                .replace(/survivor/g, 'Sobreviviente')
                .replace(/defender/g, 'Defensor')
                .replace(/hero/g, 'Héroe')
                .replace(/schematic/g, 'Esquema')
                .replace(/melee/g, 'Cuerpo a cuerpo')
                .replace(/ranged/g, 'A distancia')
                .replace(/trap/g, 'Trampa')
                .replace(/perk-up!/g, 'Perk-UP')
                .replace(/perk-up/g, 'Perk-UP');
            
            traduccion = traduccion.charAt(0).toUpperCase() + traduccion.slice(1);
            
            let colorEmoji = rarezaCruda === 'mythic' ? '🟡 Mítico' : rarezaCruda === 'legendary' ? '🟠 Legendario' : '🟣 Épico';
            let recompensaFinal = `${colorEmoji} | ${traduccion}`;

            let idUnico = `recompensa-${zonaEs}-${itemCrudo}-${pl}-${misionEs}`;
            if (!misionesGuardadas.has(idUnico)) {
                misionesGuardadas.add(idUnico);
                legendarias.push({ zona: zonaEs, recompensa: recompensaFinal, pl: pl, mision: misionEs });
            }
        }
    } catch (e) {
        console.error("Error al extraer alertas automáticas:", e);
    }

    return { pavos, legendarias };
}

// 📱 FORMATEADOR DE MENSAJES PARA WHATSAPP
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

// ⚙️ AGREGAR PAVOS MANUALMENTE 
async function comandoSetPavos(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;

    const textoArgs = args.join(' ');
    const partes = textoArgs.split('|').map(p => p.trim());
    
    if (partes.length < 4) {
        return await sock.sendMessage(chatId, { text: `❌ *Estructura incorrecta.*\n\n*!setpavos Zona | Misión | Cantidad | PL*\n\nEjemplo:\n*!setpavos Cumbres Leñosas | Rescata supervivientes | 40 | 124*` }, { quoted: msg });
    }

    let actual = await Config.findOne({ clave: 'stw_pavos_activos' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    
    lista.push({ zona: partes[0], mision: partes[1], cantidad: parseInt(partes[2]) || 30, pl: partes[3] || '??', tipo: 'Manual' });
    await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ Misión de PaVos agregada manualmente.` }, { quoted: msg });
}

// ⚙️ AGREGAR LEGENDARIAS MANUALMENTE
async function comandoSetLegendarias(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;

    const textoArgs = args.join(' ');
    const partes = textoArgs.split('|').map(p => p.trim());
    
    if (partes.length < 4) {
        return await sock.sendMessage(chatId, { text: `❌ *Estructura incorrecta.*\n\n*!setlegendarias Zona | Misión | Recompensa | PL*\n\nEjemplo:\n*!setlegendarias Cumbres Leñosas | Evacua el refugio | 🟠 Legendario | Sobreviviente | 160*` }, { quoted: msg });
    }

    let actual = await Config.findOne({ clave: 'stw_legendarias_activas' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    
    lista.push({ zona: partes[0], mision: partes[1], recompensa: partes[2], pl: partes[3] || '??' });
    await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ Misión Legendaria agregada manualmente.` }, { quoted: msg });
}

// 🗑️ VACIAR ALERTAS MANUALES
async function comandoResetPavos(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;

    await Config.findOneAndDelete({ clave: 'stw_pavos_activos' });
    await Config.findOneAndDelete({ clave: 'stw_legendarias_activas' });
    await sock.sendMessage(chatId, { text: `🗑️ Todas las alertas de PaVos y Legendarias manuales han sido restablecidas (vaciadas).` }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg) {
    await sock.sendMessage(chatId, { text: `🤖 Escribe *!pavos* o *!legendarias* para ver las misiones activas.` }, { quoted: msg });
}

// CRON JOB DIARIO
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
            } else {
                mensajeAuto += `_No hay alertas de pavos hoy._\n\n`;
            }

            if (datos.legendarias.length > 0) {
                mensajeAuto += `\n🌟 *ÉPICAS Y LEGENDARIAS*\n`;
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
    await sock.sendMessage(chatId, { text: `✅ *Grupo vinculado.* Reportes automáticos diarios a las 6:05 PM configurados.` }, { quoted: msg });
}

async function desactivarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'chat_alertas_diarias' });
    await sock.sendMessage(chatId, { text: `🔕 *Alertas desactivadas.* Ya no se enviarán reportes automáticos en este grupo.` }, { quoted: msg });
}

module.exports = { 
    obtenerAlertasSTW,
    alertasSTW, 
    comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, 
    activarAlertasDiarias,
    desactivarAlertasDiarias, 
    comandoSetPavos,
    comandoSetLegendarias,
    comandoResetPavos
};
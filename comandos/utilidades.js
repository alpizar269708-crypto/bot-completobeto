const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// 🎨 1. Sticker (Conversión de imagen/video)
async function comandoSticker(sock, msg) {
    const chatJid = msg.key.remoteJid;
    try {
        const msgTipo = msg.message?.imageMessage || msg.message?.videoMessage;
        const msjCitado = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const citadoTipo = msjCitado?.imageMessage || msjCitado?.videoMessage;

        if (!msgTipo && !citadoTipo) {
            return await sock.sendMessage(chatJid, { text: '⚠️ Por favor, responde a una imagen o video con el comando, o envíalo adjunto a la imagen.' }, { quoted: msg });
        }

        await sock.sendMessage(chatJid, { text: '✨ Procesando sticker...' }, { quoted: msg });

        const msjMultimedia = citadoTipo ? { message: msjCitado } : msg;

        const buffer = await downloadMediaMessage(
            msjMultimedia,
            'buffer',
            { },
            { reuploadRequest: sock.updateMediaMessage }
        );

        const sticker = new Sticker(buffer, {
            pack: 'TechMasters & Stream', 
            author: 'Humberto Alpízar',
            type: StickerTypes.FULL, 
            quality: 50 
        });

        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(chatJid, { sticker: stickerBuffer }, { quoted: msg });

    } catch (e) {
        console.error('Error al crear el sticker:', e);
        await sock.sendMessage(chatJid, { text: '❌ Error al crear el sticker. Asegúrate de que el archivo no sea demasiado pesado.' }, { quoted: msg });
    }
}

// 📢 2. Todos (Etiqueta masiva a miembros del grupo)
async function comandoTodos(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ Este comando solo se puede usar en grupos.' }, { quoted: msg });
        return;
    }
    try {
        const metadata = await sock.groupMetadata(chatId);
        let texto = '📢 *¡ATENCIÓN A TODOS!* 📢\n\n';
        let mentions = [];
        metadata.participants.forEach(p => {
            texto += `@${p.id.split('@')[0]} `;
            mentions.push(p.id);
        });
        await sock.sendMessage(chatId, { text: texto, mentions }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ No se pudo etiquetar a los miembros.' }, { quoted: msg });
    }
}

// 🎬 3. TikTok (Descarga sin marca de agua)
async function comandoTiktok(sock, chatId, msg, args) {
    const url = args[0];
    if (!url || !url.includes('tiktok.com')) {
        await sock.sendMessage(chatId, { text: '⚠️ Proporciona un enlace válido de TikTok. Ejemplo: `tiktok [link]`' }, { quoted: msg });
        return;
    }
    try {
        await sock.sendMessage(chatId, { text: '⏳ Descargando video de TikTok...' }, { quoted: msg });
        const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data && data.data && data.data.play) {
            const videoUrl = data.data.play;
            await sock.sendMessage(chatId, { 
                video: { url: videoUrl }, 
                caption: '🎬 *TikTok sin marca de agua*\nApoya al creador con el código: *JASC13*' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: '❌ No se pudo obtener el video.' }, { quoted: msg });
        }
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Error al procesar el enlace de TikTok.' }, { quoted: msg });
    }
}

// 🌐 4. Traduce (Traductor instantáneo)
async function comandoTraduce(sock, chatId, msg, args) {
    const idioma = args[0];
    const texto = args.slice(1).join(' ');
    if (!idioma || !texto) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `traduce [idioma] [texto]`\nEjemplo: `traduce en Hola mundo`' }, { quoted: msg });
        return;
    }
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${idioma}&dt=t&q=${encodeURIComponent(texto)}`);
        const data = await res.json();
        const traducido = data[0][0][0];
        await sock.sendMessage(chatId, { text: `🌐 *Traducción (${idioma.toUpperCase()})*:\n\n${traducido}` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Error al traducir el texto.' }, { quoted: msg });
    }
}

// 🎨 5. Skin (Buscador de objetos de Fortnite)
async function comandoSkin(sock, chatId, msg, args) {
    const nombreSkin = args.join(' ');
    if (!nombreSkin) {
        await sock.sendMessage(chatId, { text: '⚠️ Escribe el nombre de la skin. Ejemplo: `skin Midas`' }, { quoted: msg });
        return;
    }
    try {
        const res = await fetch(`https://fortnite-api.com/v2/cosmetics/br/search?name=${encodeURIComponent(nombreSkin)}&language=es`);
        const data = await res.json();
        if (data && data.status === 200 && data.data) {
            const item = data.data;
            let mensaje = `🎨 *SKIN: ${item.name}*\n\n`;
            mensaje += `📌 *Rareza:* ${item.rarity?.displayValue || 'Desconocida'}\n`;
            mensaje += `📝 *Descripción:* ${item.description || 'Sin descripción'}\n`;
            if (item.images?.icon) {
                await sock.sendMessage(chatId, { image: { url: item.images.icon }, caption: mensaje }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: mensaje }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(chatId, { text: '❌ No se encontró ninguna skin con ese nombre.' }, { quoted: msg });
        }
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Error al buscar la skin.' }, { quoted: msg });
    }
}

// 📊 6. Stats (Estadísticas de Fortnite)
async function comandoStats(sock, chatId, msg, args) {
    if (!args || args.length === 0) {
        return await sock.sendMessage(chatId, { text: `❌ Debes escribir el nombre de usuario de Epic Games.\nEjemplo: *stats alpizarh117*` }, { quoted: msg });
    }

    const nombreUsuario = args.join(' ');
    let msgCarga = await sock.sendMessage(chatId, { text: `🎮 Consultando estadísticas para *${nombreUsuario}*...` }, { quoted: msg });

    try {
        const respuesta = await fetch(`https://fortnite-api.com/v2/stats/br/v2?name=${encodeURIComponent(nombreUsuario)}`, {
            headers: {
                'Authorization': 'cbb386fe-de0e-438d-9f71-bf4001b95e9b' 
            }
        });

        const datos = await respuesta.json();

        if (!datos.status || datos.status !== 200 || !datos.data) {
            return await sock.sendMessage(chatId, { 
                text: `❌ No se encontraron estadísticas para *${nombreUsuario}*.\nVerifica que el nombre sea correcto o que su perfil sea público.` 
            }, { quoted: msg });
        }

        const stats = datos.data.stats.all.overall;
        const cuenta = datos.data.account;

        let textoRespuesta = `📊 *ESTADÍSTICAS DE EPIC GAMES*\n\n` +
            `👤 *Jugador:* ${cuenta.name}\n` +
            `🏆 *Nivel de Cuenta:* ${datos.data.battlePass.level}\n\n` +
            `🕹️ *Partidas Jugadas:* ${stats.matches}\n` +
            `👑 *Top 1:* ${stats.wins}\n` +
            `🎯 *Kills:* ${stats.kills} (${stats.kd.toFixed(2)} K/D)\n` +
            `⏱️ *Tiempo Jugado:* ${Math.round(stats.minutesPlayed / 60)} horas\n\n` +
            `Support-a-Creator: *JASC13* ❤️`;

        await sock.sendMessage(chatId, { text: textoRespuesta }, { quoted: msg });

    } catch (error) {
        console.error("Error en comando stats:", error);
        await sock.sendMessage(chatId, { text: `⚠️ Ocurrió un error de conexión al consultar la API de Fortnite para *${nombreUsuario}*.` }, { quoted: msg });
    }
};

// 🛒 7. Contacto (Menú de atención y compras)
async function comandoContacto(sock, chatId, msg) {
    let texto = `🛒 *CENTRO DE ATENCIÓN Y COMPRAS* 🛒\n\n`;
    texto += `¿Deseas adquirir paVos, skins, pases de batalla o servicios técnicos?\n\n`;
    texto += `💬 Escribe directamente al administrador para gestionar tu pedido.\n\n`;
    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

module.exports = {
    comandoSticker,
    comandoTodos,
    comandoTiktok,
    comandoTraduce,
    comandoSkin,
    comandoStats,
    comandoContacto
};

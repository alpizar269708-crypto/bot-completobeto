const { esPrivilegiadoTotal } = require('../utils/whatsapp');

async function ejecutarMenu(sock, chatId, msg, args) {
    const prefijo = ''; // Se dejó vacío para que no muestre ningún signo
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    let isAdmin = false;

    if (isGroup) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
        } catch (e) {
            console.log("Error verificando admin:", e);
        }
    }
    if (msg.key.fromMe || esPrivilegiadoTotal(sender)) isAdmin = true; 

    let menuGeneral = `🤖 *MENÚ PRINCIPAL DEL BOT* 🤖\n\n` +
    `Usa *${prefijo}menu [categoría]* para ver los comandos de cada sección.\n` +
    `Ejemplo: *${prefijo}menu economia*\n\n` +
    `📂 *CATEGORÍAS DISPONIBLES:*\n` +
    `🎮 *fortnite* - Alertas y pavos (Salvar el Mundo)\n` +
    `🛒 *tienda* - Tienda diaria de Battle Royale\n` +
    `🚀 *carry* - Sistema de escuadrones y ayuda\n` +
    `🎟️ *rifas* - Sistema de sorteos\n` +
    `💰 *economia* - Minijuegos, dinero y RPG\n` +
    `🛠️ *utilidades* - Stickers, descargas y traductor\n` +
    `🤖 *ia* - Inteligencia artificial\n`;

    if (isAdmin && isGroup) {
        menuGeneral += `🛡️ *moderacion* - Control del grupo (Admins)\n\n` +
        `⚙️ *CONFIGURACIÓN DEL GRUPO (Solo Admins):*\n` +
        `*${prefijo}activarcomandos [cat1] [cat2]* - Activa solo los módulos que quieras.\n` +
        `*${prefijo}activarcomandos todos* - Habilita todas las funciones en el grupo.\n`;
    }

    let menuFortnite = `🎮 *MENÚ FORTNITE (STW)* 🎮\n\n` +
    `*${prefijo}pavos* - Muestra misiones de pavos actuales.\n` +
    `*${prefijo}destacadasstw* - Alertas destacadas de STW.\n` +
    `*${prefijo}epicasstw* - Alertas de misiones épicas.\n` +
    `*${prefijo}legendariasstw* - Alertas de misiones legendarias.\n` +
    `*${prefijo}alertasstw* - Resumen general de alertas.\n` +
    `*${prefijo}alerta [nombre]* - Busca una recompensa específica.\n`;

    if (isAdmin && isGroup) {
        menuFortnite += `\n⚙️ *Gestión del Grupo (Admins):*\n` +
        `*${prefijo}setprecio* - Configura precio de venta de pavos.\n` +
        `*${prefijo}setgrupostw* - Activa reportes diarios a las 6:05 PM aquí.\n` +
        `*${prefijo}unsetgrupostw* - Desactiva los reportes diarios.\n`;
    }

    let menuModeracion = `🛡️ *MENÚ MODERACIÓN (Admins)* 🛡️\n\n`;
    if (isAdmin && isGroup) {
        menuModeracion += `*${prefijo}warn [@user] / verwarns* - Advierte a un usuario.\n` +
        `*${prefijo}limpiarwarns [@user]* - Borra todos los warns del usuario y lo deja en 0/3.\n` +
        `*${prefijo}ban [@user] / unban* - Expulsa o readmite.\n` +
        `*${prefijo}listanegra / unbanlist* - Gestión de bloqueados.\n` +
        `*${prefijo}grupo [abrir/cerrar]* - Abre o cierra el chat del grupo.\n` +
        `*${prefijo}mute [@user] / unmute* - Silencia a alguien.\n` +
        `*${prefijo}inactivos* - Revisa quién no habla en el grupo.\n` +
        `*${prefijo}desactivarbienvenida* - Desactiva la bienvenida en este grupo.\n` +
        `*${prefijo}activarbienvenida* - Vuelve a activar la bienvenida.\n` +
        `*${prefijo}personalizarbienvenida [mensaje]* - Personaliza la bienvenida; usa {usuario} para mencionar al nuevo integrante.\n` +
        `*${prefijo}restaurarbienvenida* - Regresa al mensaje de bienvenida por defecto.\n\n` +
        `🚫 *Gestión de Lista Negra de Carry:*\n` +
        `*${prefijo}blcarry [@user / num / cita]* - Bloquea a alguien del carry.\n` +
        `*${prefijo}unblcarry [@user / num / cita]* - Quita de la lista negra de carry.\n` +
        `*${prefijo}listcarrybl* - Muestra la lista negra de carry del grupo.\n`;
    } else {
        menuModeracion += `❌ Este menú es exclusivo para los administradores del grupo.\n`;
    }

    const menus = {
        'fortnite': menuFortnite,
        'moderacion': menuModeracion,
        'tienda': `🛒 *MENÚ TIENDA BATTLE ROYALE* 🛒\n\n` +
                  `*${prefijo}tienda* - Muestra las categorías disponibles hoy.\n` +
                  `*${prefijo}tienda [categoría]* - Muestra la imagen de esa categoría.\n`,
                  
        'carry': `🚀 *MENÚ CARRY (ESCUADRONES)* 🚀\n\n` +
                 `*${prefijo}carryleader [espacios] [motivo]* - Abre un nuevo escuadrón (Notifica a todos).\n` +
                 `*${prefijo}carryjoin* - Únete al escuadrón activo (Notifica a todos).\n` +
                 `*${prefijo}carryleave* - Sal del escuadrón en el que estás.\n` +
                 `*${prefijo}carryclose* - Cierra el escuadrón (Solo el líder).\n`,

        'rifas': `🎟️ *MENÚ RIFAS* 🎟️\n\n` +
                 `*${prefijo}rifainscripcion* - Únete a la rifa activa (1 vez por persona).\n\n` +
                 `⚙️ *Comandos Administrativos:*\n` +
                 `*${prefijo}rifa ver* - Mira la lista de participantes inscritos.\n` +
                 `*${prefijo}rifa quitar [número]* - Elimina a un participante de la lista.\n` +
                 `*${prefijo}rifa vaciar* - Limpia toda la lista de participantes.\n` +
                 `*${prefijo}rifa sortear* - Elige un ganador al azar y lo menciona.\n`,
                    
        'economia': `💰 *MENÚ ECONOMÍA* 💰\n\n` +
                    `*💼 Básico:*\n` +
                    `*${prefijo}cartera / bal* - Revisa tu dinero.\n` +
                    `*${prefijo}banco / pay* - Guarda o transfiere dinero.\n` +
                    `*${prefijo}daily / weekly* - Recompensas por conexión.\n\n` +
                    `*⛏️ Trabajo y RPG:*\n` +
                    `*${prefijo}work / crime / mendigar* - Gana dinero básico.\n` +
                    `*${prefijo}pescar / minar / cazar / explorar* - Trabajos con items.\n\n` +
                    `*🎲 Juegos de Azar:*\n` +
                    `*${prefijo}ruleta / cf / slots / dados* - Apuesta tu dinero.\n` +
                    `*${prefijo}adivina / buscaminas / ppt / carrera* - Minijuegos.\n\n` +
                    `*⚔️ Interacción:*\n` +
                    `*${prefijo}pelea / rob / hackear* - Ataca o roba a otros.\n\n` +
                    `*🎒 Tienda:*\n` +
                    `*${prefijo}shop / buy / vender* - Compra y vende objetos.\n` +
                    `*${prefijo}inventario / use / regalar* - Gestión de mochila.\n` +
                    `*${prefijo}top / topdinero* - Tabla de los más ricos.\n`,
                    
        'utilidades': `🛠️ *MENÚ UTILIDADES* 🛠️\n\n` +
                      `*${prefijo}s / sticker* - Convierte imagen/video a sticker animado.\n` +
                      `*${prefijo}todos* - Menciona a todos en el grupo.\n` +
                      `*${prefijo}tiktok [url]* - Descarga video sin marca de agua.\n` +
                      `*${prefijo}traduce [texto]* - Traduce texto al español.\n` +
                      `*${prefijo}skin [nombre] / stats [usuario]* - Info de Fortnite.\n` +
                      `*${prefijo}contacto* - Información del creador.\n` +
                      `*${prefijo}ping* - Revisa la velocidad y estado del bot.\n`,

        'ia': `🤖 *MENÚ INTELIGENCIA ARTIFICIAL* 🤖\n\n` +
              `*${prefijo}ia [pregunta]* - Habla de forma natural con el bot.\n`,
              
        'secreto': `🕵️‍♂️ *MENÚ SECRETO (Solo Owner)* 🕵️‍♂️\n\n` +
                   `*cerrarsesionauth* - (Sin prefijo) Cierra la sesión y reinicia el sistema para escanear un nuevo código de vinculación en la web.\n` +
                   `*${prefijo}activarcomandos [cat]* - Activa o desactiva módulos de comandos en un grupo.\n`
    };

    let textoEnviar = menuGeneral;

    if (args.length > 0) {
        const categoria = args[0].toLowerCase();
        if (menus[categoria]) {
            textoEnviar = menus[categoria];
        } else {
            textoEnviar = `❌ No encontré esa categoría.\n\n` + menuGeneral;
        }
    }

    await sock.sendMessage(chatId, { text: textoEnviar }, { quoted: msg });
}

module.exports = { ejecutarMenu };

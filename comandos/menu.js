async function ejecutarMenu(sock, chatId, msg, args) {
    const prefijo = '!'; 
    
    const menuGeneral = `🤖 *MENÚ PRINCIPAL DEL BOT* 🤖
    
Usa *${prefijo}menu [categoría]* para ver los comandos de cada sección.
Ejemplo: *${prefijo}menu economia*

📂 *CATEGORÍAS DISPONIBLES:*
🎮 *fortnite* - Alertas y pavos (Salvar el Mundo)
🛒 *tienda* - Tienda diaria de Battle Royale
🚀 *carry* - Sistema de escuadrones y ayuda
🎟️ *rifas* - Sistema de sorteos
💰 *economia* - Minijuegos, dinero y RPG
🛠️ *utilidades* - Stickers, descargas y traductor
🤖 *ia* - Inteligencia artificial
🛡️ *moderacion* - Control del grupo (Admins)

⚙️ *CONFIGURACIÓN DEL GRUPO (Solo Admins):*
*${prefijo}activarcomandos [categoría1] [categoria2]* - Activa solo los módulos que quieras.
*${prefijo}activarcomandos todos* - Habilita todas las funciones del bot en el grupo.`;

    const menus = {
        'fortnite': `🎮 *MENÚ FORTNITE (STW)* 🎮\n\n` +
                    `*${prefijo}pavos* - Muestra misiones de pavos actuales.\n` +
                    `*${prefijo}legendarias* - Alertas de esquemas y sobrevivientes.\n` +
                    `*${prefijo}alertasstw / salvar* - Resumen general de alertas.\n` +
                    `*${prefijo}alerta [nombre]* - Busca una recompensa específica.\n` +
                    `*${prefijo}setprecio / setpavos* - Configura precio de venta de pavos.\n\n` +
                    `⚙️ *Gestión del Grupo (Admins):*\n` +
                    `*${prefijo}setgrupostw* - Activa notificaciones diarias aquí a las 6:05 PM.\n` +
                    `*${prefijo}unsetgrupostw* - Desactiva las notificaciones diarias en el grupo.\n`,
                    
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
              
        'moderacion': `🛡️ *MENÚ MODERACIÓN (Admins)* 🛡️\n\n` +
                      `*${prefijo}warn [@user] / verwarns* - Advierte a un usuario.\n` +
                      `*${prefijo}ban [@user] / unban* - Expulsa o readmite.\n` +
                      `*${prefijo}listanegra / unbanlist* - Gestión de bloqueados.\n` +
                      `*${prefijo}grupo [abrir/cerrar]* - Abre o cierra el chat del grupo.\n` +
                      `*${prefijo}mute [@user] / unmute* - Silencia a alguien.\n` +
                      `*${prefijo}inactivos* - Revisa quién no habla en el grupo.\n`,
                      
        'secreto': `🕵️‍♂️ *MENÚ SECRETO (Solo Owner)* 🕵️‍♂️\n\n` +
                   `*cerrarsesionauth* - (Sin prefijo) Borra la sesión de MongoDB y reinicia el bot para escanear QR nuevo en la web.\n` +
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
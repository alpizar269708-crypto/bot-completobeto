async function ejecutarMenu(sock, chatId, msg, args) {
    const categoria = args[0]?.toLowerCase();
    let texto = '';

    if (categoria === 'admin' || categoria === 'moderacion') {
        texto = `🛡️ *MENÚ DE MODERACIÓN Y ADMIN* 🛡️\n\n` +
                `• \`warn @usuario [motivo]\` — Advierte a un usuario\n` +
                `• \`verwarns [@usuario]\` — Revisa historial de warns\n` +
                `• \`ban @usuario [motivo]\` — Banea del sistema\n` +
                `• \`unban @usuario\` — Desbanea del sistema\n` +
                `• \`listanegra\` / \`banlist\` — Ver lista de baneados\n` +
                `• \`unbanlist [número]\` — Remueve de la lista negra\n` +
                `• \`grupo [cerrar / abrir]\` — Bloquea o abre el chat\n` +
                `• \`mute [@usuario] [min]\` — Silencia con borrado automático\n` +
                `• \`unmute [@usuario]\` — Quita el silencio\n` +
                `• \`inactivos\` — Recuento de miembros\n\n` +
                `🎟️ *Sistema de Rifas (Solo Admins):*\n` +
                `• \`rifa agregar [nombre]\` — Añade participante\n` +
                `• \`rifa ver\` — Muestra participantes\n` +
                `• \`rifa quitar [número/nombre]\` — Borra participante\n` +
                `• \`rifa sortear\` — Saca un ganador al azar\n\n` +
                `💡 _Exclusivo para administradores del grupo._`;

    } else if (categoria === 'fortnite' || categoria === 'stw') {
        texto = `🎮 *MENÚ DE FORTNITE Y SALVAR EL MUNDO* 🎮\n\n` +
                `• \`pavos\` — Alertas de paVos en tiempo real\n` +
                `• \`legendarias\` — Alertas de objetos legendarios\n` +
                `• \`setgrupostw\` — Vincula grupo para reporte\n` +
                `• \`tienda\` — Muestra la tienda BR y categorías\n` +
                `• \`skin [nombre]\` — Busca información de una skin\n` +
                `• \`stats [usuario]\` — Estadísticas de Epic Games\n` +
                `• \`setpavos\` / \`resetpavos\` — Gestión manual de respaldo\n\n` +
                `🚀 *Escuadrones / Carries de STW:*\n` +
                `• \`carryleader [motivo] [espacios]\` — Crea escuadrón (Ej: carryleader jefe 4)\n` +
                `• \`carryjoin\` — Únete al escuadrón activo\n` +
                `• \`carryleave\` — Sal del escuadrón actual\n` +
                `• \`carryclose\` — Cancela el escuadrón (Solo Líder)\n\n` +
                `Support-a-Creator: *JASC13* ❤️`;

    } else if (categoria === 'utilidades' || categoria === 'util') {
        texto = `🛠️ *MENÚ DE UTILIDADES Y HERRAMIENTAS* 🛠️\n\n` +
                `• \`s\` / \`sticker\` — Convierte imagen/video en sticker\n` +
                `• \`todos\` — Etiqueta masiva a todo el grupo\n` +
                `• \`tiktok [link]\` — Descarga video sin marca de agua\n` +
                `• \`traduce [idioma] [texto]\` — Traductor instantáneo\n` +
                `• \`contacto\` — Centro de atención y compras\n` +
                `• \`ia [texto]\` — Consulta con Inteligencia Artificial`;

    } else if (categoria === 'juegos' || categoria === 'economia' || categoria === 'casino') {
        texto = `🎲 *MENÚ DE ECONOMÍA, CASINO Y PVP* 🎲\n\n` +
                `💵 *Finanzas y Bancos:*\n` +
                `• \`cartera\` / \`bal\` | \`banco [dep/ret]\`\n` +
                `• \`pay @usuario [cant]\` | \`top\`\n\n` +
                `⛏️ *Farmeo y Trabajos:*\n` +
                `• \`daily\` / \`weekly\` | \`farmear\` / \`work\`\n` +
                `• \`crime\` | \`mendigar\` | \`pescar\` / \`minar\`\n\n` +
                `🎰 *Casino y Apuestas:*\n` +
                `• \`ruleta\` | \`cf\` | \`slots\` | \`dados\`\n` +
                `• \`adivina [1-10]\` | \`buscaminas\`\n\n` +
                `⚔️ *PvP e Inventario:*\n` +
                `• \`rob\` | \`ppt\` | \`pelea\` | \`carrera\` | \`hackear\`\n` +
                `• \`shop\` / \`buy\` / \`inventario\` / \`vender\` / \`use\` / \`regalar\``;

    } else {
        texto = `🤖 *MENÚ PRINCIPAL - ESCUPIDERA DE SALTY* 🤖\n\n` +
                `Escribe el comando que necesites o explora por categorías usando:\n\n` +
                `🛡️ \`menu admin\` — Moderación, rifas y seguridad\n` +
                `🎮 \`menu fortnite\` — Alertas STW, carrys y tienda\n` +
                `🛠️ \`menu utilidades\` — Herramientas y descargas\n` +
                `🎲 \`menu juegos\` — Economía, casino y PvP\n\n` +
                `✨ _¡Disfruta tu estancia en el grupo!_`;
    }

    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

module.exports = { ejecutarMenu };
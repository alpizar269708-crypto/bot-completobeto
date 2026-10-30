const { esPrivilegiadoTotalAsync } = require('../utils/whatsapp');
const { Config } = require('../database/modelos');

const categoriasMap = {
    fortnite: ['pavos', 'destacadasstw', 'legendariasstw', 'epicasstw', 'alertasstw', 'stw', 'alerta', 'alertanov', 'recompensa', 'recompensanov', 'subirpl', 'guiapl', 'buildstw'],
    tienda: ['tienda', 'tiendavb'],
    carry: ['carryleader', 'carryjoin', 'carryleave', 'carryclose', 'buscocarry', 'doycarry', 'x2busco'],
    rifas: ['rifa', 'rifainscripcion', 'cerrarrifa', 'rifajasc13', 'addvarios', 'abrirrifa', 'activarrifaaqui', 'menurifajasc13'],
    cashback: ['addcashback', 'delcashback', 'vercash', 'delvcash', 'canjecash'],
    economia: ['cartera', 'bal', 'banco', 'pay', 'pagar', 'top', 'topdinero', 'daily', 'weekly', 'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar', 'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt', 'pelea', 'carrera', 'hackear', 'shop', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar'],
    utilidades: ['s', 'sticker', 'tiktok', 'instagram', 'pinterest', 'x', 'twitter', 'traduce', 'skin', 'stats', 'tiendastats', 'tiendavb', 'contacto', 'ping', 'verelim'],
    paypal: ['paypal', 'paypaln', 'paypali'],
    ia: ['ia'],
    moderacion: ['warn', 'advertir', 'verwarns', 'limpiarwarns', 'ban', 'unban', 'listanegra', 'banlist', 'unbanlist', 'grupo', 'mute', 'unmute', 'listablanca', 'desactivarbienvenida', 'activarbienvenida', 'personalizarbienvenida', 'restaurarbienvenida', 'blcarry', 'unblcarry', 'listcarrybl', 'setprecio', 'setgrupostw', 'unsetgrupostw', 'desactivarcomandos', 'catdesa']
};

const nombresCategorias = ['fortnite', 'tienda', 'carry', 'rifas', 'cashback', 'economia', 'utilidades', 'paypal', 'ia', 'moderacion'];

async function obtenerCategoriasActivas(chatId) {
    if (!chatId.endsWith('@g.us')) return nombresCategorias;
    const config = await Config.findOne({ clave: `comandos_desactivados_${chatId}` }).lean();
    if (!config?.valor) return nombresCategorias;
    try {
        const desactivados = JSON.parse(config.valor);
        if (!Array.isArray(desactivados)) return nombresCategorias;
        return nombresCategorias.filter(cat => !desactivados.includes(cat));
    } catch (e) {
        return nombresCategorias;
    }
}

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
    if (msg.key.fromMe || await esPrivilegiadoTotalAsync(sock, sender)) isAdmin = true;

    // La configuración de desactivarcomandos se aplica a TODOS los miembros,
    // incluidos administradores y el creador. Por defecto todo está activo;
    // solo se ocultan/deshabilitan las categorías guardadas como desactivadas.
    let categoriasActivas = await obtenerCategoriasActivas(chatId);
    if (!isAdmin || !isGroup) categoriasActivas = categoriasActivas.filter(cat => cat !== 'moderacion'); 

    const descripcionCategorias = {
        fortnite: '🎮 *fortnite* - Alertas y PaVos de Salvar el Mundo',
        tienda: '🛒 *tienda* - Tienda diaria de Battle Royale',
        carry: '🚀 *carry* - Sistema de escuadrones y ayuda',
        rifas: '🎟️ *rifas* - Sistema de sorteos',
        cashback: '💰 *cashback* - Gestión independiente de cashback',
        economia: '💰 *economia* - Minijuegos, dinero y RPG',
        utilidades: '🛠️ *utilidades* - Stickers, descargas y traductor',
        ia: '🤖 *ia* - Inteligencia artificial',
        paypal: '💳 *paypal* - Tarifas y calculadoras de PayPal (MXN/USD)',
        moderacion: '🛡️ *moderacion* - Control del grupo (Admins)'
    };

    let menuGeneral = `🤖 *MENÚ PRINCIPAL DEL BOT* 🤖\n\n` +
    `Usa *${prefijo}menu [categoría]* para ver los comandos de cada sección.\n` +
    `Ejemplo: *${prefijo}menu economia*\n\n` +
    `📋 *${prefijo}vertodoscomandos* - Ver todos los comandos disponibles y su función.\n\n` +
    `📂 *CATEGORÍAS DISPONIBLES:*\n` +
    categoriasActivas.map(cat => descripcionCategorias[cat]).join('\n') + '\n';


    let menuFortnite = `🎮 *MENÚ FORTNITE (STW)* 🎮\n\n` +
    `*${prefijo}pavos* - Muestra misiones de pavos actuales.\n` +
    `*${prefijo}destacadasstw* - Lista completa de alertas destacadas útiles.\n` +
    `*${prefijo}epicasstw* - Recompensas épicas útiles (héroes, supervivientes, defensores y esquemas).\n` +
    `*${prefijo}legendariasstw* - Recompensas legendarias útiles de esas categorías.\n` +
    `*${prefijo}alertasstw* - Resumen breve: PaVos y hasta 10 alertas destacadas; usa los comandos por rareza para las listas completas.\n` +
    `*${prefijo}alerta [nombre]* - Busca una alerta por misión o recompensa.\n` +
    `*${prefijo}alertanov [nombre]* - Muestra detalles, modificadores y requisitos disponibles; nunca muestra x4/x5.\n` +
    `*${prefijo}recompensa [tipo] [rareza]* - Busca recompensas concretas; por ejemplo: *recompensa defensor legendario* o *recompensa héroe épico*.\n` +
    `*${prefijo}recompensanov [tipo] [rareza]* - Igual, pero con detalles de la misión y cantidades disponibles.\n` +
    `*${prefijo}subirpl [PL]* - Recomienda misiones útiles para subir potencia según el PL indicado (por defecto PL 62).\n` +
    `*${prefijo}subirpl oro* - Busca alertas guardadas que indiquen oro como recompensa.\n` +
    `*${prefijo}guiapl* - Te hace preguntas numeradas y genera una guía personal con la rotación de alertas que extrae el bot. Responde con números; puedes escribir *cancelar* para salir.\n` +
    `*${prefijo}buildstw [nombre]* - Busca una build para un arma o héroe concreto, con perks, recomendaciones y fuentes web. Ejemplos: *buildstw Nocturno* o *buildstw Ramirez*.\\n`;

    // Los comandos administrativos se encuentran en *menú moderación*.


    let menuModeracion = `🛡️ *MENÚ MODERACIÓN (Admins)* 🛡️\n\n`;
    if (isAdmin && isGroup) {
        menuModeracion += `*${prefijo}warn [@user] / verwarns* - Advierte a un usuario.\n` +
        `*${prefijo}limpiarwarns [@user]* - Borra todos los warns del usuario y lo deja en 0/3.\n` +
        `*${prefijo}ban [@user] / unban* - Expulsa o readmite.\n` +
        `*${prefijo}listanegra / unbanlist* - Gestión de bloqueados.\n` +
        `*${prefijo}grupo [abrir/cerrar]* - Abre o cierra el chat del grupo.\n` +
        `*${prefijo}mute [@user] / unmute* - Silencia a alguien.\n` +
        `*${prefijo}desactivarbienvenida* - Desactiva la bienvenida en este grupo.\n` +
        `*${prefijo}activarbienvenida* - Vuelve a activar la bienvenida.\n` +
        `*${prefijo}personalizarbienvenida [mensaje]* - Personaliza la bienvenida; usa {usuario} para mencionar al nuevo integrante.\n` +
        `*${prefijo}restaurarbienvenida* - Regresa al mensaje de bienvenida por defecto.\n` +
        `*${prefijo}setprecio* - Configura el precio de venta de PaVos.\n` +
        `*${prefijo}setgrupostw* / *${prefijo}unsetgrupostw* - Activa o desactiva reportes diarios de STW.\n` +
        `*${prefijo}desactivarcomandos [categorías]* / *${prefijo}catdesa* - Administra las categorías activas.\n\n` +
        `🟢 *Lista Blanca de Links:*\n` +
        `*${prefijo}listablanca agregar [link o dominio]* - Permite un link concreto o un dominio completo.\n` +
        `Ejemplo: *${prefijo}listablanca agregar betomaster.com* - Permite todas las rutas y subdominios de betomaster.com.\n` +
        `*${prefijo}listablanca quitar [link o dominio]* - Elimina una entrada.\n` +
        `*${prefijo}listablanca ver* - Muestra las entradas permitidas.\n` +
        `*${prefijo}listablanca vaciar* - Vacía la lista blanca.\n\n` +
        `🚫 *Gestión de Lista Negra de Carry:*\n` +
        `*${prefijo}blcarry [@user / num / cita]* - Bloquea a alguien del carry.\n` +
        `*${prefijo}unblcarry [@user / num / cita]* - Quita de la lista negra de carry.\n` +
        `*${prefijo}listcarrybl* - Muestra la lista negra de carry del grupo.\n`;
    } else {
        menuModeracion += `❌ Este menú es exclusivo para los administradores del grupo.\n`;
    }

    const menus = {
        'paypal': `💳 *MENÚ PAYPAL* 💳\n\n` +
                  `*${prefijo}paypal* - Muestra las tarifas estándar actuales de PayPal para México, nacional e internacional.\n` +
                  `*${prefijo}paypaln [cantidad MXN]* - Calcula cuánto deben enviarte para recibir esa cantidad neta en pesos.\n` +
                  `*${prefijo}paypali [cantidad USD]* - Calcula cuánto deben enviarte para recibir esa cantidad neta en dólares.\n`,

        'fortnite': menuFortnite,
        'moderacion': menuModeracion,
        'tienda': `🛒 *MENÚ TIENDA BATTLE ROYALE* 🛒\n\n` +
                  `*${prefijo}tienda* - Muestra las categorías disponibles hoy.\n` +
                  `*${prefijo}tienda [categoría]* - Muestra la imagen de esa categoría.\n` + `*${prefijo}tiendaVb [paVos]* - Convierte paVos a MXN y USD.\n`,
                  
        'carry': `🚀 *MENÚ CARRY (ESCUADRONES)* 🚀\n\n` +
                 `*${prefijo}id TuIDDeEpic* - Registra o actualiza tu ID de Epic.\\n` +
                 `*${prefijo}carryleader [espacios] [motivo]* - Abre un nuevo escuadrón (Notifica a todos).\n` +
                 `*${prefijo}carryjoin* - Únete al escuadrón activo (Notifica a todos).\n` +
                 `*${prefijo}carryleave* - Sal del escuadrón en el que estás.\n` +
                 `*${prefijo}carryclose* - Cierra el escuadrón (Solo el líder).\n` +
                 `*${prefijo}buscocarry [1-3] [motivo]* - Busca carry y notifica a todos con mención oculta.\n` +
                 `*${prefijo}buscooff* - Cierra la búsqueda activa (quien la abrió o admin).\n` +
                 `*${prefijo}doycarry* - Entra a ofrecer el carry.\n` +
                 `*${prefijo}x2busco* - Entra como otro jugador que busca carry.\n`,

        'rifas': `🎟️ *MENÚ RIFAS* 🎟️\n\n` +
                 `*${prefijo}abrirrifa* - Inicia/abre una rifa en este grupo (administradores).\n` +
                 `*${prefijo}activarrifaaqui* - Activa la rifa en este grupo (administradores).\n` +
                 `*${prefijo}rifainscripcion* - Únete a la rifa activa (1 vez por persona).\n` +
                 `*${prefijo}cerrarrifa* - Cierra las inscripciones sin borrar participantes (administradores).\n\n` +
                 `⚙️ *Comandos Administrativos:*\n` +
                 `*${prefijo}rifa ver* - Mira la lista de participantes inscritos.\n` +
                 `*${prefijo}rifa quitar [número]* - Elimina a un participante de la lista.\n` +
                 `*${prefijo}rifa vaciar* - Limpia toda la lista de participantes.\n` +
                 `*${prefijo}rifa sortear* - Elige un ganador al azar y lo menciona.\n\n` +
                 `⭐ *RIFA JASC13 (solo creador):*\n` +
                 `*${prefijo}rifajasc13 [número]sumar [puntos]* - Suma puntos a la rifa.\n` +
                 `*${prefijo}rifajasc13 addvarios* - Suma puntos a varios números en un solo mensaje.\n` +
                 `Ejemplo: 1. 1000 / 2. 3000 / 5) 5000.\n` +
                 `*${prefijo}rifajasc13 ver* - Muestra puntos y boletos.\n` +
                 `♻️ *Recuperación JASC13:* reenvía un mensaje histórico para recuperar los puntos sin tocar el cashback.\n`,
        'cashback': `💰 *MENÚ CASHBACK JASC13* 💰\n\n` +
                 `🔒 Todos estos comandos son solo para el propietario de la rifa JASC13.\n\n` +
                 `➕ *${prefijo}addcashback @usuario cantidad* - Agrega cashback.\n` +
                 `↩️ También puedes responder al mensaje del usuario: *${prefijo}addcashback cantidad*.\n` +
                 `➖ *${prefijo}delcashback @usuario cantidad* - Quita cashback.\n` +
                 `↩️ También puedes responder al mensaje del usuario: *${prefijo}delcashback cantidad*.\n` +
                 `👀 *${prefijo}vercash* - Muestra todos los usuarios con cashback y sus saldos.\n` +
                 `🗑️ *${prefijo}delvcash 1-3, 5, 9, 15-27* - Elimina registros por número.\n` +
                 `💸 *${prefijo}canjecash @usuario cantidad* - Canjea y descuenta cashback.\n`,
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
                      `*${prefijo}tiktok [url]* - Descarga video sin marca de agua.\n` +
                      `*${prefijo}instagram [url]* - Descarga video de Instagram.\n` +
                      `*${prefijo}pinterest [url]* - Descarga fotos, carruseles y videos de Pinterest; también basta con enviar el enlace.\n` +
                      `*${prefijo}x [url]* - Descarga fotos y videos de X/Twitter; también basta con enviar el enlace.\n` +
                      `*${prefijo}traduce [texto]* - Traduce texto al español.\n` +
                      `*${prefijo}stats [usuario]* - Consulta estadísticas de Fortnite.\n` +
                      `*${prefijo}tiendastats [nombre]* - Consulta estadísticas del cosmético.\n` + `*${prefijo}tiendaVb [paVos]* - Convierte paVos a MXN y USD.\n` +
                      `*${prefijo}contacto* - Información del creador.\n` +
                      `*${prefijo}ping* - Revisa la velocidad y estado del bot.\n` +
                      `*${prefijo}verelim* - Muestra mensajes eliminados para todos en este chat durante las últimas 2 horas.\n`,

        'ia': `🤖 *MENÚ INTELIGENCIA ARTIFICIAL* 🤖\n\n` +
              `*${prefijo}ia [pregunta]* - Habla de forma natural con el bot.\n`,
              
        'secreto': `🕵️‍♂️ *MENÚ SECRETO (Solo Owner)* 🕵️‍♂️\n\n` +
                   `*cerrarsesionauth* - (Sin prefijo) Cierra la sesión y reinicia el sistema para escanear un nuevo código de vinculación en la web.\n`
    };

    let textoEnviar = menuGeneral;

    if (args.length > 0) {
        const categoria = args[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (categoria === 'moderacion' && (!isAdmin || !isGroup)) {
            textoEnviar = '❌ El menú de moderación es exclusivo para administradores del grupo.\n';
        } else if (menus[categoria] && categoriasActivas.includes(categoria)) {
            textoEnviar = menus[categoria];
        } else if (menus[categoria] && !categoriasActivas.includes(categoria)) {
            textoEnviar = `❌ Esa categoría no está activa en este grupo.\n\n` + menuGeneral;
        } else {
            textoEnviar = `❌ No encontré esa categoría.\n\n` + menuGeneral;
        }
    }

    await sock.sendMessage(chatId, { text: textoEnviar }, { quoted: msg });
}

module.exports = { ejecutarMenu };

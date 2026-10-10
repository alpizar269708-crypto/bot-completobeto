const { esPrivilegiadoTotalAsync } = require('../utils/whatsapp');
const { Config } = require('../database/modelos');

const categoriasMap = {
    fortnite: ['pavos', 'destacadasstw', 'legendariasstw', 'epicasstw', 'alertasstw', 'stw', 'alerta', 'alertanob', 'setgrupostw', 'unsetgrupostw', 'setprecio'],
    tienda: ['tienda', 'tiendavb'],
    carry: ['carryleader', 'carryjoin', 'carryleave', 'carryclose', 'blcarry', 'unblcarry', 'listcarrybl'],
    rifas: ['rifa', 'rifainscripcion', 'cerrarrifa', 'rifajasc13', 'addvarios', 'abrirrifa', 'activarrifaaqui', 'menurifajasc13'],
    cashback: ['addcashback', 'delcashback', 'vercash', 'delvcash', 'canjecash'],
    economia: ['cartera', 'bal', 'banco', 'pay', 'pagar', 'top', 'topdinero', 'daily', 'weekly', 'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar', 'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt', 'pelea', 'carrera', 'hackear', 'shop', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar'],
    utilidades: ['s', 'sticker', 'tiktok', 'instagram', 'traduce', 'skin', 'stats', 'tiendastats', 'tiendavb', 'contacto', 'ping'],
    paypal: ['paypal', 'paypaln', 'paypali'],
    ia: ['ia'],
    moderacion: ['warn', 'advertir', 'verwarns', 'limpiarwarns', 'ban', 'unban', 'listanegra', 'banlist', 'unbanlist', 'grupo', 'mute', 'unmute', 'inactivos', 'listablanca', 'desactivarbienvenida', 'activarbienvenida', 'personalizarbienvenida', 'restaurarbienvenida']
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
    const categoriasActivas = await obtenerCategoriasActivas(chatId); 

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

    if (isAdmin && isGroup) {
        menuGeneral += `\n⚙️ *CONFIGURACIÓN DEL GRUPO (Solo Admins):*\n` +
        `*${prefijo}desactivarcomandos [cat1] [cat2]* - Desactiva una o varias categorías; se van acumulando.\n` +
        `*${prefijo}desactivarcomandos todos* - Desactiva todas las categorías.\n` +
        `*${prefijo}desactivarcomandos ninguno* - Vuelve a activar todo el bot.\n` +
        `*${prefijo}catdesa* - Muestra las categorías desactivadas y permite reactivar una por número durante 3 minutos.\n`;
    }

    let menuFortnite = `🎮 *MENÚ FORTNITE (STW)* 🎮\n\n` +
    `*${prefijo}pavos* - Muestra misiones de pavos actuales.\n` +
    `*${prefijo}destacadasstw* - Lista completa de alertas destacadas útiles.\n` +
    `*${prefijo}epicasstw* - Recompensas épicas útiles (héroes, supervivientes, defensores y esquemas).\n` +
    `*${prefijo}legendariasstw* - Recompensas legendarias útiles de esas categorías.\n` +
    `*${prefijo}alertasstw* - Resumen breve: PaVos y hasta 10 alertas destacadas; usa los comandos por rareza para las listas completas.\n` +
    `*${prefijo}alerta [nombre]* - Busca una recompensa específica con datos resumidos.\n` +
    `*${prefijo}alertanob [nombre]* - Alerta para novatos: muestra detalles de la misión, modificadores y requisitos disponibles; nunca muestra multiplicadores x4/x5.\n`;

    menuFortnite += `\n🚀 *CARRY / ESCUADRONES:*\n` +
        `*${prefijo}carryleader [1-3] [motivo]* - Crea un escuadrón indicando cuántos jugadores faltan.\n` +
        `*${prefijo}carryjoin* - Únete al escuadrón activo.\n` +
        `*${prefijo}carryleave* - Sal del escuadrón actual.\n` +
        `*${prefijo}carryclose* - Cierra tu escuadrón.\n` +
        `*${prefijo}blcarry [@user / número / cita]* - Bloquea a alguien del carry (Admins).\n` +
        `*${prefijo}unblcarry [@user / número / cita]* - Quita a alguien de la lista negra (Admins).\n` +
        `*${prefijo}listcarrybl* - Muestra la lista negra de carry (Admins).\n`;

    menuFortnite += `\n⚙️ *Gestión del Grupo:*\n` +
        `*${prefijo}setprecio* - Configura precio de venta de pavos.\n` +
        `*${prefijo}setgrupostw* - Activa reportes diarios a las 6:05 PM aquí.\n` +
        `*${prefijo}unsetgrupostw* - Desactiva los reportes diarios.\n`;

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
                      `*${prefijo}traduce [texto]* - Traduce texto al español.\n` +
                      `*${prefijo}stats [usuario]* - Consulta estadísticas de Fortnite.\n` +
                      `*${prefijo}tiendastats [nombre]* - Consulta estadísticas del cosmético.\n` + `*${prefijo}tiendaVb [paVos]* - Convierte paVos a MXN y USD.\n` +
                      `*${prefijo}contacto* - Información del creador.\n` +
                      `*${prefijo}ping* - Revisa la velocidad y estado del bot.\n`,

        'ia': `🤖 *MENÚ INTELIGENCIA ARTIFICIAL* 🤖\n\n` +
              `*${prefijo}ia [pregunta]* - Habla de forma natural con el bot.\n`,
              
        'secreto': `🕵️‍♂️ *MENÚ SECRETO (Solo Owner)* 🕵️‍♂️\n\n` +
                   `*cerrarsesionauth* - (Sin prefijo) Cierra la sesión y reinicia el sistema para escanear un nuevo código de vinculación en la web.\n` +
                   `*${prefijo}desactivarcomandos [cat1] [cat2]* - Desactiva categorías del grupo; se van acumulando.\n` +
                   `*${prefijo}desactivarcomandos ninguno* - Vuelve a activar todo el bot.\n` +
                   `*${prefijo}catdesa* - Muestra las categorías desactivadas y permite reactivar una por número durante 3 minutos.\n`
    };

    let textoEnviar = menuGeneral;

    if (args.length > 0) {
        const categoria = args[0].toLowerCase();
        if (menus[categoria] && categoriasActivas.includes(categoria)) {
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

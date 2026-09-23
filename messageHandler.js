const mongoose = require('mongoose'); 
const { ejecutarMenu } = require('./comandos/menu');
const { alertasSTW, comandoDestacadasSTW, comandoPreguntarAlerta, activarAlertasDiarias, desactivarAlertasDiarias } = require('./comandos/fortnite');
const { comandoTiendaMenu, comandoTiendaCategoria } = require('./comandos/tienda'); 
const { 
    comandoSticker, comandoTodos, comandoTiktok, comandoTraduce, comandoSkin, comandoStats, comandoContacto 
} = require('./comandos/utilidades');
const { responderConIA } = require('./comandos/ia');
const { 
    verificarAntiLinks, verificarAntiSpam, comandoListaBlancaLinks, comandoWarn, comandoLimpiarWarns, comandoVerWarns, comandoBan, 
    comandoUnban, comandoListaNegra, comandoUnbanList, comandoGrupo, comandoMute, 
    comandoUnmute, verificarMute, comandoInactivos, comandoDesactivarBienvenida, comandoActivarBienvenida, comandoPersonalizarBienvenida, comandoRestaurarBienvenida 
} = require('./comandos/moderacion');
const { User, Config } = require('./database/modelos');
const { obtenerEconomia } = require('./comandos/economia');
const { 
    comandoCartera, comandoBanco, comandoPay, comandoTop, comandoDaily, comandoWeekly,
    ejecutarFarmeo, comandoRuleta, comandoCf, comandoSlots, comandoDados, comandoAdivina,
    comandoBuscaminas, comandoRob, comandoPpt, comandoPelea, comandoCarrera, comandoHackear,
    comandoShop, comandoBuy, comandoInventario, comandoVender, comandoUse, comandoRegalarItem 
} = require('./comandos/economia');
const { comandoRifa, comandoRifaInscripcion, comandoRifaJasc13, comandoMenuRifaJasc13, comandoAbrirRifa, comandoActivarRifaAqui, comandoCerrarRifa } = require('./comandos/rifas');
const { comandoCarry } = require('./comandos/carry');
const { esProgramadorBot } = require('./comandos/programadorbot');

const categoriasMap = {
    'fortnite': ['pavos', 'destacadasstw', 'legendariasstw', 'epicasstw', 'alertasstw', 'stw', 'alerta', 'setgrupostw', 'unsetgrupostw', 'setprecio'],
    'economia': ['cartera', 'bal', 'banco', 'pay', 'pagar', 'top', 'topdinero', 'daily', 'weekly', 'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar', 'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt', 'pelea', 'carrera', 'hackear', 'shop', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar'],
    'utilidades': ['s', 'sticker', 'todos', 'tiktok', 'traduce', 'skin', 'stats', 'contacto'],
    'ia': ['ia'],
    'moderacion': ['warn', 'advertir', 'verwarns', 'limpiarwarns', 'ban', 'unban', 'listanegra', 'banlist', 'unbanlist', 'grupo', 'mute', 'unmute', 'inactivos', 'listablanca'],
    'tienda': ['tienda'],
    'carry': ['carryleader', 'carryjoin', 'carryleave', 'carryclose', 'blcarry', 'unblcarry', 'listcarrybl'],
    'rifas': ['rifa', 'rifainscripcion', 'cerrarrifa'],
    'menu': ['menu', 'menusecreto']
};

const cacheConfigComandos = new Map();
const cacheBaneoUsuario = new Map();
const CACHE_TTL_MS = 5000;

const comandosEconomia = new Set(['cartera','bal','banco','pay','pagar','top','topdinero','daily','weekly','farmear','work','crime','mendigar','pescar','minar','cazar','explorar','ruleta','cf','slots','dados','adivina','buscaminas','rob','ppt','pelea','carrera','hackear','shop','buy','inventario','mochila','vender','use','regalar']);

const comandosConUsuarioBD = new Set([
    'cartera', 'bal', 'banco', 'pay', 'pagar', 'daily', 'weekly',
    'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar',
    'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt',
    'pelea', 'carrera', 'hackear', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar'
]);

const comandosValidos = new Set([
        'activarcomandos', 'setprecio', 'ping', 'pavos', 'destacadasstw', 'legendariasstw', 'epicasstw', 'alertasstw', 'stw', 'alerta', 
        'setgrupostw', 'unsetgrupostw', 'grupo', 'mute', 'unmute', 'inactivos', 'tienda', 'ia', 'menu', 'menusecreto',
        's', 'sticker', 'todos', 'tiktok', 'traduce', 'skin', 'stats', 'contacto',
        'warn', 'advertir', 'verwarns', 'limpiarwarns', 'ban', 'unban', 'listanegra', 'banlist', 'unbanlist', 
        'cartera', 'bal', 'banco', 'pay', 'pagar', 'top', 'topdinero', 'daily', 'weekly',
        'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar',
        'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt', 'pelea',
        'carrera', 'hackear', 'shop', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar',
        'rifa', 'rifainscripcion', 'cerrarrifa', 'rifajasc13', 'programadorbot', 'abrirrifa', 'activarrifaaqui', 'menurifajasc13', 'carryleader', 'carryjoin', 'carryleave', 'carryclose', 'blcarry', 'unblcarry', 'listcarrybl',
        'vertodosconandos', 'vertodoscomandos', 'listablanca', 'desactivarbienvenida', 'activarbienvenida', 'personalizarbienvenida', 'restaurarbienvenida'
]);

async function procesarMensaje(sock, msg) {
    const chatJid = msg.key.remoteJid;
    const textoOriginal = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';
    if (!textoOriginal) return;

    const normalizarComando = (texto) => (texto || '')
        .trim()
        .split(/\s+/)[0]
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^[!/.]/, '');

    const esProgramador = esProgramadorBot(msg);
    msg.programadorBot = esProgramador;

    const comandoPropioPermitido = new Set([
        'warn', 'advertir', 'verwarns', 'limpiarwarns',
        'ban', 'unban', 'listanegra', 'banlist', 'unbanlist',
        'listablanca'
    ]);

    // Los mensajes enviados por el propio número del bot normalmente se ignoran.
    // Excepción: solo se aceptan los comandos de warns/lista negra definidos arriba.
    if (!esProgramador && msg.key.fromMe && !comandoPropioPermitido.has(normalizarComando(textoOriginal))) return;

    if (normalizarComando(textoOriginal) === 'cerrarsesionauth') {
        if (msg.key.fromMe || true) { 
            console.log('🔴 Comando de cierre de sesión recibido...');
            try {
                await sock.sendMessage(chatJid, { text: `🔴 Sesión cerrada.

Para volver a iniciar sesion, ingresa a: 
bot-completobeto.onrender.com

*Espere 1 minuto antes de ingresar al link de inicio de sesion*

Apoya a un creador: JASC13` });
                await mongoose.model('auth_session').deleteMany({});
            } catch (err) {}
            setTimeout(() => { process.exit(0); }, 2000);
            return;
        }
    }

    const textoComandoPrevio = normalizarComando(textoOriginal);
    const esComandoPropioPermitido = esProgramador || (msg.key.fromMe && comandoPropioPermitido.has(textoComandoPrevio));

    // La lista blanca se procesa antes del anti-links para permitir agregar cualquier URL.
    if (textoComandoPrevio === 'listablanca') {
        const partesListaBlanca = textoOriginal.trim().split(/\s+/);
        await comandoListaBlancaLinks(sock, chatJid, msg, partesListaBlanca.slice(1));
        return;
    }

    if (!esComandoPropioPermitido && await verificarAntiLinks(sock, msg)) return;

    const remitenteReal = msg.key.participant || chatJid;
    if (!esComandoPropioPermitido && verificarMute(chatJid, remitenteReal)) {
        try { await sock.sendMessage(chatJid, { delete: msg.key }); } catch (e) {}
        return;
    }

    const textoMinusculas = textoOriginal.toLowerCase();
    const textoLimpio = textoMinusculas.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    let args = textoLimpio.split(/ +/);
    let comandoRaw = args.shift();
    let comando = normalizarComando(comandoRaw);
    const esComandoValido = comandosValidos.has(comando);

    // El anti-spam necesita consultar los administradores del grupo en WhatsApp.
    // Esa consulta es costosa y hacía que CADA comando esperara a groupMetadata().
    // Los mensajes que ya sabemos que son comandos no pasan por ese filtro:
    // la protección anti-spam sigue activa para los mensajes normales.
    if (!esComandoPropioPermitido && !esComandoValido && await verificarAntiSpam(sock, msg)) return;

    // Si no es un comando conocido, no consultamos MongoDB.
    if (!esComandoValido) return;

    let configGrupo = null;
    if (chatJid.endsWith('@g.us')) {
        const cache = cacheConfigComandos.get(chatJid);
        if (cache && cache.expira > Date.now()) {
            configGrupo = cache.valor;
        } else {
            configGrupo = await Config.findOne({ clave: `comandos_${chatJid}` });
            cacheConfigComandos.set(chatJid, { valor: configGrupo, expira: Date.now() + CACHE_TTL_MS });
        }
    }
    if (configGrupo && !msg.key.fromMe && !esProgramador && chatJid.endsWith('@g.us')) {
        let permitidos = JSON.parse(configGrupo.valor);
        let comandoPermitido = false;
        
        if (permitidos.includes(comando)) comandoPermitido = true;
        
        for (let cat of permitidos) {
            if (categoriasMap[cat] && categoriasMap[cat].includes(comando)) {
                comandoPermitido = true; break;
            }
        }
        
        if (!comandoPermitido && comando !== 'activarcomandos') return; 
    }

    // Solo los comandos llegan hasta aquí; los mensajes normales ya salieron arriba.
    // Los comandos que realmente necesitan el documento completo lo cargan una vez.
    // Para el resto solo comprobamos el baneo y lo cacheamos unos segundos.
    let usuarioBD = null;
    if (comandosConUsuarioBD.has(comando)) {
        usuarioBD = await User.findOne({ numero: remitenteReal });
        if (!usuarioBD) usuarioBD = await User.create({ numero: remitenteReal });

        if (usuarioBD.baneado && !esProgramador) return;
    } else {
        const cacheBaneo = cacheBaneoUsuario.get(remitenteReal);
        if (cacheBaneo && cacheBaneo.expira > Date.now()) {
            if (cacheBaneo.baneado && !esProgramador) return;
        } else {
            const usuarioEstado = await User.findOne({ numero: remitenteReal }).select('baneado').lean();
            const baneado = !!usuarioEstado?.baneado;
            cacheBaneoUsuario.set(remitenteReal, { baneado, expira: Date.now() + CACHE_TTL_MS });
            if (baneado && !esProgramador) return;
        }
    }


    let economiaBD = null;
    if (comandosEconomia.has(comando)) {
        economiaBD = await obtenerEconomia(chatJid, remitenteReal);
    }

    if (comando === 'programadorbot') {
        if (!esProgramador) return;
        await sock.sendMessage(chatJid, { text: '🛠️ *PROGRAMADORBOT ACTIVO*\n\nAcceso maestro habilitado para este número. Las restricciones de administrador, propietario, comandos restringidos, mute y baneo del bot quedan ignoradas para tus comandos.' }, { quoted: msg });
        return;
    }

    if (comando === 'desactivarbienvenida') {
        await comandoDesactivarBienvenida(sock, chatJid, msg);
        return;
    }

    if (comando === 'activarbienvenida') {
        await comandoActivarBienvenida(sock, chatJid, msg);
        return;
    }

    if (comando === 'personalizarbienvenida') {
        await comandoPersonalizarBienvenida(sock, chatJid, msg, args.join(' '));
        return;
    }

    if (comando === 'restaurarbienvenida') {
        await comandoRestaurarBienvenida(sock, chatJid, msg);
        return;
    }

    if (comando === 'abrirrifa') {
        await comandoAbrirRifa(sock, chatJid, msg);
        return;
    }

    if (comando === 'activarrifaaqui') {
        await comandoActivarRifaAqui(sock, chatJid, msg);
        return;
    }

    if (comando === 'cerrarrifa') {
        await comandoCerrarRifa(sock, chatJid, msg);
        return;
    }

    if (comando === 'vertodosconandos' || comando === 'vertodoscomandos') {
        const comandosInfo = [
            ['activarcomandos', 'Activa todos los comandos o restringe el grupo a categorías concretas.'],
            ['listablanca', 'Administra la lista blanca de links permitidos. Estructura: links_lista_blanca = ["https://ejemplo.com", "https://otro.com/ruta"].'],
            ['setprecio', 'Configura el precio de los pavos.'],
            ['ping', 'Comprueba que el bot esté activo.'],
            ['pavos', 'Muestra las misiones actuales que dan paVos en Salvar el Mundo.'],
            ['destacadasstw', 'Muestra las alertas destacadas de Salvar el Mundo.'],
            ['legendariasstw', 'Muestra misiones con recompensas legendarias.'],
            ['epicasstw', 'Muestra misiones con recompensas épicas.'],
            ['alertasstw', 'Muestra el resumen general de alertas de Salvar el Mundo.'],
            ['stw', 'Alias de alertasstw.'],
            ['alerta', 'Busca una recompensa específica en las alertas de Salvar el Mundo.'],
            ['setgrupostw', 'Activa los reportes diarios de Salvar el Mundo en el grupo.'],
            ['unsetgrupostw', 'Desactiva los reportes diarios de Salvar el Mundo.'],
            ['grupo', 'Abre o cierra el chat del grupo.'],
            ['mute', 'Silencia a un usuario del grupo.'],
            ['unmute', 'Quita el silencio a un usuario.'],
            ['inactivos', 'Muestra quiénes llevan tiempo sin participar en el grupo.'],
            ['tienda', 'Muestra la tienda diaria de Fortnite o una categoría concreta.'],
            ['ia', 'Permite conversar con la inteligencia artificial del bot.'],
            ['menu', 'Muestra el menú principal o una categoría específica.'],
            ['menusecreto', 'Muestra el menú secreto del bot.'],
            ['s', 'Convierte una imagen o video en sticker.'],
            ['sticker', 'Alias de s para crear stickers.'],
            ['todos', 'Menciona a todos los participantes del grupo.'],
            ['tiktok', 'Descarga un video de TikTok.'],
            ['traduce', 'Traduce un texto al español.'],
            ['skin', 'Busca información de una skin de Fortnite.'],
            ['stats', 'Consulta estadísticas de un usuario de Fortnite.'],
            ['contacto', 'Muestra la información de contacto del creador.'],
            ['warn', 'Advierte a un usuario del grupo.'],
            ['advertir', 'Alias de warn.'],
            ['verwarns', 'Consulta las advertencias de un usuario.'],
            ['limpiarwarns', 'Borra todos los warns del usuario indicado y lo deja en 0/3.'],
            ['ban', 'Expulsa a un usuario del grupo.'],
            ['unban', 'Permite readmitir a un usuario expulsado.'],
            ['listanegra', 'Gestiona o consulta la lista negra.'],
            ['banlist', 'Alias de listanegra.'],
            ['unbanlist', 'Gestiona la lista de usuarios bloqueados.'],
            ['cartera', 'Consulta tu dinero disponible.'],
            ['bal', 'Alias de cartera.'],
            ['banco', 'Consulta o gestiona el dinero guardado en el banco.'],
            ['pay', 'Transfiere dinero a otro usuario.'],
            ['pagar', 'Alias de pay.'],
            ['top', 'Muestra la clasificación de usuarios con más dinero.'],
            ['topdinero', 'Alias de top.'],
            ['daily', 'Obtén la recompensa diaria.'],
            ['weekly', 'Obtén la recompensa semanal.'],
            ['shop', 'Muestra los objetos disponibles en la tienda del sistema.'],
            ['buy', 'Compra un objeto de la tienda del sistema.'],
            ['inventario', 'Muestra tus objetos disponibles.'],
            ['mochila', 'Alias de inventario.'],
            ['vender', 'Vende un objeto de tu inventario.'],
            ['use', 'Usa un objeto de tu inventario.'],
            ['regalar', 'Regala un objeto a otro usuario.'],
            ['rifa', 'Administra la rifa: ver, quitar, vaciar o sortear.'],
            ['rifainscripcion', 'Permite inscribirse en la rifa activa.'],
            ['cerrarrifa', 'Cierra la rifa general e impide nuevas inscripciones sin borrar a los participantes actuales.'],
            ['rifajasc13', 'Gestiona la rifa especial de JASC13.'],
            ['menurifajasc13', 'Muestra el menú de la rifa JASC13.'],
            ['abrirrifa', 'Inicia una rifa; en grupos la puede iniciar un administrador.'],
            ['activarrifaaqui', 'Activa la rifa en el grupo para permitir inscripciones.'],
            ['carryleader', 'Crea un escuadrón de carry y define sus espacios.'],
            ['carryjoin', 'Se une al escuadrón de carry activo.'],
            ['carryleave', 'Sale del escuadrón de carry actual.'],
            ['carryclose', 'Cierra el escuadrón de carry.'],
            ['blcarry', 'Añade a un usuario a la lista negra de carry.'],
            ['unblcarry', 'Quita a un usuario de la lista negra de carry.'],
            ['listcarrybl', 'Muestra la lista negra de carry.'],
            ['vertodoscomandos', 'Muestra esta lista de comandos y para qué sirve cada uno.'],
            ['desactivarbienvenida', 'Desactiva la bienvenida automática en este grupo.'],
            ['activarbienvenida', 'Vuelve a activar la bienvenida automática en este grupo.'],
            ['personalizarbienvenida', 'Cambia el mensaje de bienvenida; usa {usuario} para mencionar al nuevo integrante.'],
            ['restaurarbienvenida', 'Restaura el mensaje de bienvenida predeterminado.'],
            ['cerrarsesionauth', 'Cierra la sesión de WhatsApp del bot para volver a vincularla.']
        ];

        const texto = [
            '🕵️‍♂️ *COMANDOS DEL BOT* 🕵️‍♂️',
            '',
            'Lista de comandos útiles, administrativos, de Fortnite, rifas, carry y utilidades.',
            'Se excluyeron los comandos de minijuegos, apuestas y acciones tipo RPG.',
            '',
            ...comandosInfo.map(([cmd, descripcion], i) => `${i + 1}. *${cmd}* — ${descripcion}`),
            '',
            'Apoya a un creador: *JASC13* ❤️'
        ].join('\n');

        await sock.sendMessage(chatJid, { text: texto }, { quoted: msg });
        return;
    }

    if (comandosValidos.has(comando)) {
        switch (comando) {
            case 'menusecreto':
                if (!msg.key.fromMe && !esProgramador) return; 
                await ejecutarMenu(sock, chatJid, msg, ['secreto']);
                break;
            case 'activarcomandos':
                if (chatJid.endsWith('@g.us')) {
                    const remitente = msg.key.participant || chatJid;
                    let esAdmin = msg.key.fromMe || esProgramador;
                    if (!esAdmin) {
                        try {
                            const groupMeta = await sock.groupMetadata(chatJid);
                            const part = groupMeta.participants.find(p => p.id === remitente);
                            esAdmin = part && (part.admin === 'admin' || part.admin === 'superadmin');
                        } catch (e) {}
                    }
                    if (!esAdmin) {
                        await sock.sendMessage(chatJid, { text: `❌ Solo los administradores del grupo pueden configurar los comandos.` }, { quoted: msg });
                        return;
                    }
                } else if (!msg.key.fromMe && !esProgramador) {
                    return; 
                }
                
                if (args.length === 0 || args[0] === 'todos') {
                    await Config.deleteOne({ clave: `comandos_${chatJid}` });
                    await sock.sendMessage(chatJid, { text: '✅ Todos los comandos han sido activados en este grupo.' }, { quoted: msg });
                } else {
                    await Config.findOneAndUpdate({ clave: `comandos_${chatJid}` }, { valor: JSON.stringify(args) }, { upsert: true });
                    await sock.sendMessage(chatJid, { text: `✅ Se han restringido los comandos en este grupo.\nCategorías activas: ${args.join(', ')}` }, { quoted: msg });
                }
                break;
            case 'ia':
                await responderConIA(sock, chatJid, msg, args.join(' '));
                break;
            case 'menu':
                await ejecutarMenu(sock, chatJid, msg, args);
                break;
            case 'setprecio':
                await Config.findOneAndUpdate({ clave: 'precio_pavos' }, { valor: args.join(' ') }, { upsert: true });
                await sock.sendMessage(chatJid, { text: `✅ Precio actualizado.` }, { quoted: msg });
                break;
            case 'ping':
                await sock.sendMessage(chatJid, { text: '¡Pong! 🤖 Activo.' }, { quoted: msg });
                break;
            case 'pavos':
                await alertasSTW(sock, chatJid, msg, 'pavos');
                break;
            case 'destacadasstw':
                await comandoDestacadasSTW(sock, chatJid, msg);
                break;
            case 'legendariasstw':
                await alertasSTW(sock, chatJid, msg, 'legendarias');
                break;
            case 'epicasstw':
                await alertasSTW(sock, chatJid, msg, 'epicas');
                break;
            case 'alertasstw':
            case 'stw':
                await alertasSTW(sock, chatJid, msg, 'todas');
                break;
            case 'alerta':
                if (args.length > 0) await comandoPreguntarAlerta(sock, chatJid, msg, args);
                else await comandoPreguntarAlerta(sock, chatJid, msg);
                break;
            case 'setgrupostw':
                await activarAlertasDiarias(sock, chatJid, msg);
                break;
            case 'unsetgrupostw':
                await desactivarAlertasDiarias(sock, chatJid, msg);
                break;
            case 'tienda':
                if (args.length === 0) await comandoTiendaMenu(sock, chatJid, msg);
                else await comandoTiendaCategoria(sock, chatJid, msg, args.join(' '));
                break;
            case 's':
            case 'sticker':
                await comandoSticker(sock, msg);
                break;
            case 'todos':
                await comandoTodos(sock, chatJid, msg);
                break;
            case 'tiktok':
                await comandoTiktok(sock, chatJid, msg, args);
                break;
            case 'traduce':
                await comandoTraduce(sock, chatJid, msg, args);
                break;
            case 'skin':
                await comandoSkin(sock, chatJid, msg, args);
                break;
            case 'stats':
                await comandoStats(sock, chatJid, msg, args);
                break;
            case 'contacto':
                await comandoContacto(sock, chatJid, msg);
                break;
            case 'warn':
            case 'advertir':
                await comandoWarn(sock, chatJid, msg, args);
                break;
            case 'verwarns':
                await comandoVerWarns(sock, chatJid, msg, args);
                break;
            case 'limpiarwarns':
                await comandoLimpiarWarns(sock, chatJid, msg, args);
                break;
            case 'ban':
                await comandoBan(sock, chatJid, msg, args);
                break;
            case 'unban':
                await comandoUnban(sock, chatJid, msg, args);
                break;
            case 'listanegra':
            case 'banlist':
                await comandoListaNegra(sock, chatJid, msg);
                break;
            case 'unbanlist':
                await comandoUnbanList(sock, chatJid, msg, args);
                break;
            case 'grupo':
                await comandoGrupo(sock, chatJid, msg, args);
                break;
            case 'mute':
                await comandoMute(sock, chatJid, msg, args);
                break;
            case 'unmute':
                await comandoUnmute(sock, chatJid, msg, args);
                break;
            case 'inactivos':
                await comandoInactivos(sock, chatJid, msg);
                break;
            case 'cartera':
            case 'bal':
                await comandoCartera(sock, chatJid, msg, economiaBD); 
                break;
            case 'banco':
                await comandoBanco(sock, chatJid, msg, args, economiaBD);
                break;
            case 'pay':
            case 'pagar':
                await comandoPay(sock, chatJid, msg, args, economiaBD);
                break;
            case 'top':
            case 'topdinero':
                await comandoTop(sock, chatJid, msg); 
                break;
            case 'daily':
                await comandoDaily(sock, chatJid, msg, economiaBD);
                break;
            case 'weekly':
                await comandoWeekly(sock, chatJid, msg, economiaBD);
                break;
            case 'farmear':
            case 'work':
                await ejecutarFarmeo(sock, chatJid, msg, economiaBD, 'work');
                break;
            case 'crime':
                await ejecutarFarmeo(sock, chatJid, msg, economiaBD, 'crime');
                break;
            case 'mendigar':
                await ejecutarFarmeo(sock, chatJid, msg, economiaBD, 'mendigar');
                break;
            case 'pescar':
            case 'minar':
            case 'cazar':
            case 'explorar':
                await ejecutarFarmeo(sock, chatJid, msg, economiaBD, comando);
                break;
            case 'ruleta':
                await comandoRuleta(sock, chatJid, msg, args, economiaBD);
                break;
            case 'cf':
                await comandoCf(sock, chatJid, msg, args, economiaBD);
                break;
            case 'slots':
                await comandoSlots(sock, chatJid, msg, args, economiaBD);
                break;
            case 'dados':
                await comandoDados(sock, chatJid, msg, args, economiaBD);
                break;
            case 'adivina':
                await comandoAdivina(sock, chatJid, msg, args, economiaBD);
                break;
            case 'buscaminas':
                await comandoBuscaminas(sock, chatJid, msg, args, economiaBD);
                break;
            case 'rob':
                await comandoRob(sock, chatJid, msg, args, economiaBD);
                break;
            case 'ppt':
                await comandoPpt(sock, chatJid, msg, args, economiaBD);
                break;
            case 'pelea':
                await comandoPelea(sock, chatJid, msg, args, economiaBD);
                break;
            case 'carrera':
                await comandoCarrera(sock, chatJid, msg, args, economiaBD);
                break;
            case 'hackear':
                await comandoHackear(sock, chatJid, msg, args, economiaBD);
                break;
            case 'shop':
                await comandoShop(sock, chatJid, msg);
                break;
            case 'buy':
                await comandoBuy(sock, chatJid, msg, args, economiaBD);
                break;
            case 'inventario':
            case 'mochila':
                await comandoInventario(sock, chatJid, msg, economiaBD);
                break;
            case 'vender':
                await comandoVender(sock, chatJid, msg, args, economiaBD);
                break;
            case 'use':
                await comandoUse(sock, chatJid, msg, args, economiaBD);
                break;
            case 'regalar':
                await comandoRegalarItem(sock, chatJid, msg, args, economiaBD);
                break;
            case 'rifa':
                await comandoRifa(sock, chatJid, msg, args);
                break;
            case 'rifainscripcion':
                await comandoRifaInscripcion(sock, chatJid, msg);
                break;
            case 'rifajasc13':
                await comandoRifaJasc13(sock, chatJid, msg, args);
                break;
            case 'menurifajasc13':
                await comandoMenuRifaJasc13(sock, chatJid, msg);
                break;
            case 'carryleader':
            case 'carryjoin':
            case 'carryleave':
            case 'carryclose':
            case 'blcarry':
            case 'unblcarry':
            case 'listcarrybl':
                await comandoCarry(sock, chatJid, msg, comando, args);
                break;
        }
    }
}

module.exports = { procesarMensaje };

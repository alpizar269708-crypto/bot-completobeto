const { Config } = require('../database/modelos');

// 🛒 Menú principal si solo escriben "tienda"
async function comandoTiendaMenu(sock, chatId, msg) {
    const texto = `🛒 *MENÚ DE TIENDA FORTNITE*\n\nUsa el comando con una categoría:\n\n` +
                  `🔷 tienda nuevos\n` +
                  `🔷 tienda se van hoy\n` +
                  `🔷 tienda skins\n` +
                  `🔷 tienda bailes\n` +
                  `🔷 tienda picos\n` +
                  `🔷 tienda mochilas\n` +
                  `🔷 tienda lotes\n` +
                  `🔷 tienda otros\n\n` +
                  `Apoya a un creador: JASC13`;
    
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

// 🛒 Función de categorías de la Tienda
async function comandoTiendaCategoria(sock, chatId, msg, categoria) {
    const catLimpia = categoria ? categoria.toLowerCase().trim() : 'todos';

    try {
        const respuesta = await fetch('https://fortnite-api.com/v2/shop?language=es', {
            headers: { 'x-api-key': 'cbb386fe-de0e-438d-9f71-bf4001b95e9b' }
        });
        const resultado = await respuesta.json();

        if (!resultado || resultado.status !== 200 || !resultado.data || !resultado.data.entries) {
            return await sock.sendMessage(chatId, { text: `❌ Error al obtener los datos de la API.` }, { quoted: msg });
        }

        // --- SISTEMA DE MEMORIA PARA DETECTAR ROTACIONES ("NUEVOS" REALES) ---
        const fechaActualShop = resultado.data.date; // Fecha oficial de la tienda actual
        let mem = await Config.findOne({ clave: 'memoria_tienda' });
        let datosMemoria = mem ? JSON.parse(mem.valor) : null;
        
        let itemsAyer = new Set();
        let itemsHoy = [];
        let guardarNuevaMemoria = false;

        if (datosMemoria) {
            if (datosMemoria.fecha === fechaActualShop) {
                // Sigue siendo la misma tienda de hoy
                itemsAyer = new Set(datosMemoria.items_anteriores);
            } else {
                // ¡La tienda rotó! Los actuales de ayer, ahora son los anteriores
                itemsAyer = new Set(datosMemoria.items_actuales);
                guardarNuevaMemoria = true; // Hay que guardar la nueva foto
            }
        } else {
            // Primera vez que se ejecuta el bot con este sistema
            guardarNuevaMemoria = true;
        }
        // -------------------------------------------------------------------

        const outDates = resultado.data.entries
            .map(e => e.outDate)
            .filter(d => d && new Date(d).getTime() > Date.now())
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        
        const fechaSeVanHoy = outDates.length > 0 ? outDates[0] : null;

        let productosMap = new Map();

        resultado.data.entries.forEach(entry => {
            const vbucks = entry.finalPrice || 0;
            
            let titulo = 'Desconocido';
            let tipo = 'otro';
            let fechaAgregado = null;

            // 1. Extraer los datos del ítem
            if (entry.bundle && entry.bundle.name) {
                titulo = entry.bundle.name;
                tipo = 'bundle';
                if (entry.brItems && entry.brItems.length > 0) fechaAgregado = entry.brItems[0].added;
                else if (entry.items && entry.items.length > 0) fechaAgregado = entry.items[0].added;
            } else if (entry.tracks && entry.tracks.length > 0) {
                titulo = entry.tracks[0].title || 'Pista de Festival';
                tipo = 'track';
                fechaAgregado = entry.tracks[0].added;
            } else if (entry.cars && entry.cars.length > 0) {
                titulo = entry.cars[0].name || 'Auto Rocket Racing';
                tipo = 'car';
                fechaAgregado = entry.cars[0].added;
            } else if (entry.instruments && entry.instruments.length > 0) {
                titulo = entry.instruments[0].name || 'Instrumento';
                tipo = 'instrument';
                fechaAgregado = entry.instruments[0].added;
            } else if (entry.legoKits && entry.legoKits.length > 0) {
                titulo = entry.legoKits[0].name || 'Kit LEGO';
                tipo = 'lego';
                fechaAgregado = entry.legoKits[0].added;
            } else if (entry.brItems && entry.brItems.length > 0) {
                titulo = entry.brItems[0].name;
                tipo = (entry.brItems[0].type?.value || 'otro').toLowerCase();
                fechaAgregado = entry.brItems[0].added;
            } else if (entry.items && entry.items.length > 0) {
                titulo = entry.items[0].name;
                tipo = (entry.items[0].type?.value || 'otro').toLowerCase();
                fechaAgregado = entry.items[0].added;
            } else {
                return; 
            }

            const uniqueId = entry.offerId || titulo;
            if (uniqueId) itemsHoy.push(uniqueId); // Lo metemos a la foto de hoy

            // --- TRIPLE FILTRO INFALIBLE DE NUEVOS ---
            let esNuevo = false;

            // Filtro 1 (El de Fortnite.gg): ¿Acaba de entrar hoy a la rotación y ayer no estaba?
            if (itemsAyer.size > 0 && uniqueId && !itemsAyer.has(uniqueId)) {
                esNuevo = true;
            }

            // Filtro 2 (Respaldo): La etiqueta oficial de Epic Games
            const bannerVal = (entry.banner?.value || entry.banner?.backendValue || '').toLowerCase();
            const sectionId = (entry.section?.id || '').toLowerCase();
            if (bannerVal.includes('nuevo') || bannerVal.includes('new') || sectionId.includes('new')) {
                esNuevo = true;
            }

            // Filtro 3 (Respaldo 2): Items recién metidos al código del juego (7 días)
            if (!esNuevo && fechaAgregado) {
                const diasDesdeAgregado = (Date.now() - new Date(fechaAgregado).getTime()) / (1000 * 60 * 60 * 24);
                if (diasDesdeAgregado <= 7) esNuevo = true;
            }
            // -----------------------------------------

            const seVanHoy = (entry.outDate === fechaSeVanHoy);
            const clave = uniqueId + '-' + vbucks;

            if (!productosMap.has(clave)) {
                productosMap.set(clave, {
                    titulo: titulo,
                    tipo: tipo,
                    vbucks: vbucks,
                    mxn: Math.round(vbucks * 0.09),
                    esNuevo: esNuevo,
                    seVanHoy: seVanHoy
                });
            }
        });

        const productos = Array.from(productosMap.values());

        // Actualizar la memoria en la base de datos si hubo rotación
        if (guardarNuevaMemoria) {
            const nuevaData = {
                fecha: fechaActualShop,
                items_actuales: itemsHoy,
                items_anteriores: Array.from(itemsAyer)
            };
            await Config.findOneAndUpdate(
                { clave: 'memoria_tienda' },
                { valor: JSON.stringify(nuevaData) },
                { upsert: true }
            );
        }

        // Filtrado final de categorías
        let filtrados = productos;
        const principales = ['outfit', 'emote', 'pickaxe', 'backpack', 'bundle', 'glider', 'dance'];

        if (catLimpia.includes('skin') || catLimpia.includes('traje')) {
            filtrados = productos.filter(p => p.tipo === 'outfit');
        } else if (catLimpia.includes('baile') || catLimpia.includes('emote') || catLimpia.includes('gesto')) {
            filtrados = productos.filter(p => p.tipo === 'emote' || p.tipo === 'dance');
        } else if (catLimpia.includes('pico') || catLimpia.includes('hacha')) {
            filtrados = productos.filter(p => p.tipo === 'pickaxe');
        } else if (catLimpia.includes('mochila') || catLimpia.includes('backpack')) {
            filtrados = productos.filter(p => p.tipo === 'backpack');
        } else if (catLimpia.includes('lote') || catLimpia.includes('bundle')) {
            filtrados = productos.filter(p => p.tipo === 'bundle');
        } else if (catLimpia.includes('nuevo')) {
            filtrados = productos.filter(p => p.esNuevo);
        } else if (catLimpia.includes('se van') || catLimpia.includes('hoy')) {
            filtrados = productos.filter(p => p.seVanHoy);
        } else if (catLimpia.includes('otro')) {
            filtrados = productos.filter(p => !principales.includes(p.tipo));
        }

        if (filtrados.length === 0) {
            return await sock.sendMessage(chatId, { text: `🛒 *TIENDA DE FORTNITE*\n\nActualmente no hay artículos en la categoría: *${catLimpia.toUpperCase()}*.` }, { quoted: msg });
        }

        let texto = `🛒 *TIENDA DE FORTNITE* (${catLimpia.toUpperCase()}) - ${filtrados.length} items\n\n`;
        
        filtrados.forEach(p => {
            texto += `🔷 *${p.titulo}* — ${p.vbucks} V-Bucks o $${p.mxn} MXN\n`;
        });

        texto += `\nApoya a un creador: JASC13`;
        
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });

    } catch (error) {
        console.error("Error en API de Fortnite:", error);
        await sock.sendMessage(chatId, { text: `❌ Hubo un error de conexión al leer la tienda.` }, { quoted: msg });
    }
}

module.exports = {
    comandoTiendaMenu,
    comandoTiendaCategoria
};
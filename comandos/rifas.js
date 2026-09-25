
        let texto = '🎟️ *PARTICIPANTES - RIFA JASC13*\n\n';
        let i = 1;
        const mentions = [];

        for (const [id, data] of participantes.entries()) {
            const usuario = id?.split('@')[0] || 'Usuario desconocido';
            const boletos = Math.floor(data.puntos / 1000);
            const resto = data.puntos % 1000;
            const faltantes = resto === 0 ? 0 : 1000 - resto;

            texto += `👤 *${i}. @${usuario}*\n`;
            texto += `💎 Puntos: *${data.puntos}*\n`;
            texto += `🎟️ Boletos: *${boletos}* (Faltan *${faltantes} pts*)\n\n`;

            mentions.push(id);
            i++;
        }

        return await sock.sendMessage(chatId, { text: texto, mentions });
    }

    if (accion === 'vaciar') {
        participantes.clear();
        await Config.findOneAndUpdate(
            { clave: CLAVE_PARTICIPANTES_JASC13 },
            { valor: '[]' },
            { upsert: true }
        );

        return await sock.sendMessage(chatId, {
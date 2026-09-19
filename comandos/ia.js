const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function responderConIA(sock, numero, msg, texto) {
    let intentos = 0;
    const maxIntentos = 2;

    while (intentos < maxIntentos) {
        try {
            const model = genAI.getGenerativeModel({ 
                model: 'gemini-3.6-flash',
                systemInstruction: 'Eres el asistente virtual oficial de Jasc-Store. Sé extremadamente breve, directo y preciso (máximo 1 o 2 oraciones). Ve al grano sin explicaciones largas ni rodeos. Termina siempre con una breve mención o invitación a checar el catálogo en https://jasc-store.com/tienda.'
            });

            const result = await model.generateContent(texto);
            const respuesta = result.response.text();

            await sock.sendMessage(numero, { text: respuesta }, { quoted: msg });
            return; // Salimos si todo sale bien

        } catch (error) {
            intentos++;
            console.log(`Intento ${intentos} fallido con Gemini AI:`, error.message);

            if (intentos >= maxIntentos) {
                // Mensaje limpio y elegante si los servidores siguen ocupados
                await sock.sendMessage(numero, { 
                    text: `🤖 Los servidores están con alta demanda en este momento. Intenta de nuevo en unos segundos.\n\n🔗 Checa nuestro catálogo: https://jasc-store.com/tienda` 
                }, { quoted: msg });
            } else {
                // Espera 1 segundo antes de reintentar
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
}

module.exports = { responderConIA };
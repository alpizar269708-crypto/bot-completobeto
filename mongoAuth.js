const mongoose = require('mongoose');
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

const Schema = new mongoose.Schema({
    _id: { type: String, required: true },
    data: { type: String, required: true }
});
const Auth = mongoose.model('auth_session', Schema);

async function resetMongoDBAuthState() {
    // En el arranque rápido MongoDB puede estar desconectado. Si WhatsApp
    // devuelve 401 y aquí intentamos borrar la sesión, Mongoose deja
    // deleteMany() en buffer y termina en "buffering timed out".
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
    }

    await Auth.deleteMany({});
}

async function useMongoDBAuthState(collectionName, options = {}) {
    const lazy = !!options.lazy;
    // Cargamos toda la sesión de WhatsApp una sola vez al arrancar.
    // Antes se hacía una consulta a MongoDB por cada clave de Baileys,
    // lo que podía provocar decenas/cientos de consultas y hacer que
    // WhatsApp tardara muchísimo en terminar de iniciar sesión.
    const documentos = lazy ? [] : await Auth.find({}).lean();
    const cache = new Map();

    for (const documento of documentos) {
        if (documento?._id && documento?.data) {
            try {
                cache.set(documento._id, JSON.parse(documento.data, BufferJSON.reviver));
            } catch (error) {
                console.error('⚠️ No se pudo leer una credencial de WhatsApp:', documento._id);
            }
        }
    }

    let persistente = !lazy;

    const writeData = async (data, id) => {
        const informationToStore = JSON.stringify(data, BufferJSON.replacer);
        cache.set(id, data);

        if (!persistente) return;

        await Auth.findOneAndUpdate(
            { _id: id },
            { data: informationToStore },
            { upsert: true }
        );
    };

    const activarPersistencia = async () => {
        if (persistente) return;
        await Auth.deleteMany({});
        for (const [id, data] of cache.entries()) {
            await Auth.findOneAndUpdate(
                { _id: id },
                { data: JSON.stringify(data, BufferJSON.replacer) },
                { upsert: true }
            );
        }
        persistente = true;
    };

    const readData = async (id) => {
        return cache.get(id) ?? null;
    };

    const removeData = async (id) => {
        cache.delete(id);
        await Auth.deleteOne({ _id: id });
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async id => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        },
        activatePersistence: activarPersistencia
    };
}
module.exports = { useMongoDBAuthState, resetMongoDBAuthState };
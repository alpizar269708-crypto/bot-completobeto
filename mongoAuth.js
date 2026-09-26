const mongoose = require('mongoose');
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

const Schema = new mongoose.Schema({
    _id: { type: String, required: true },
    data: { type: String, required: true }
});
const Auth = mongoose.model('auth_session', Schema);

async function resetMongoDBAuthState() {
    await Auth.deleteMany({});
}

async function useMongoDBAuthState(collectionName) {
    // Cargamos toda la sesión de WhatsApp una sola vez al arrancar.
    // Antes se hacía una consulta a MongoDB por cada clave de Baileys,
    // lo que podía provocar decenas/cientos de consultas y hacer que
    // WhatsApp tardara muchísimo en terminar de iniciar sesión.
    const documentos = await Auth.find({}).lean();
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

    const writeData = async (data, id) => {
        const informationToStore = JSON.stringify(data, BufferJSON.replacer);
        cache.set(id, data);

        await Auth.findOneAndUpdate(
            { _id: id },
            { data: informationToStore },
            { upsert: true }
        );
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
        }
    };
}
module.exports = { useMongoDBAuthState, resetMongoDBAuthState };
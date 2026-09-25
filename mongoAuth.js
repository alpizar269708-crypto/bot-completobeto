const mongoose = require('mongoose');
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

const Schema = new mongoose.Schema({
    _id: { type: String, required: true },
    data: { type: String, required: true }
});
const Auth = mongoose.model('auth_session', Schema);

async function resetMongoDBAuthState(collectionName) {
    await Auth.deleteMany({});
}

async function useMongoDBAuthState(collectionName) {
    const writeData = async (data, id) => {
        const informationToStore = JSON.stringify(data, BufferJSON.replacer);
        await Auth.findOneAndUpdate(
            { _id: id },
            { data: informationToStore },
            { upsert: true }
        );
    };

    const readData = async (id) => {
        try {
            const data = await Auth.findOne({ _id: id });
            return data ? JSON.parse(data.data, BufferJSON.reviver) : null;
        } catch (error) {
            return null;
        }
    };

    const removeData = async (id) => {
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
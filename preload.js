const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nsa', {
    onLoad: (callback) => {
        ipcRenderer.on('nsa:load', (event, payload) => callback(payload));
    },
    close: () => ipcRenderer.invoke('nsa:close'),
    splash: (message) => ipcRenderer.invoke('nsa:splash', message),
    isDarkMode: () => ipcRenderer.sendSync('nsa:darkMode'),
    onDarkModeChange: (callback) => {
        ipcRenderer.on('nsa:darkMode-changed', (event, dark) => callback(dark));
    }
});

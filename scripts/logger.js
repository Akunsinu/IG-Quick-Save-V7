// logger.js - Persistent logging system for IG Quick Save
// Survives service worker restarts, exports to file on demand

const Logger = (() => {
  const CONFIG = {
    MAX_MEMORY_LOGS: 200,
    MAX_STORAGE_LOGS: 2000,
    FLUSH_INTERVAL_MS: 10000, // Flush every 10 seconds
    STORAGE_KEY: 'ig_debug_logs',
    LOG_LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 }
  };

  let memoryBuffer = [];
  let flushTimer = null;
  let sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

  function createEntry(level, category, message, data = null) {
    const entry = {
      id: `${sessionId}-${Date.now()}`,
      ts: new Date().toISOString(),
      lvl: Object.keys(CONFIG.LOG_LEVELS).find(k => CONFIG.LOG_LEVELS[k] === level),
      cat: category,
      msg: message,
      sid: sessionId
    };

    if (data !== null) {
      try {
        entry.data = JSON.parse(JSON.stringify(data, (key, value) => {
          if (typeof value === 'function') return '[Function]';
          if (value instanceof Error) return { error: value.message, stack: value.stack };
          return value;
        }));
      } catch (e) {
        entry.data = { serializeError: e.message };
      }
    }

    if (level >= CONFIG.LOG_LEVELS.ERROR) {
      entry.stack = new Error().stack.split('\n').slice(3, 8).join('\n');
    }

    return entry;
  }

  function addToMemory(entry) {
    memoryBuffer.push(entry);
    if (memoryBuffer.length > CONFIG.MAX_MEMORY_LOGS) {
      memoryBuffer.shift();
    }
  }

  async function flushToStorage() {
    if (memoryBuffer.length === 0) return;

    try {
      const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      let storedLogs = result[CONFIG.STORAGE_KEY] || [];
      storedLogs = storedLogs.concat(memoryBuffer);

      if (storedLogs.length > CONFIG.MAX_STORAGE_LOGS) {
        storedLogs = storedLogs.slice(-CONFIG.MAX_STORAGE_LOGS);
      }

      await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: storedLogs });
      memoryBuffer = [];
    } catch (e) {
      console.error('[Logger] Flush failed:', e);
    }
  }

  function init() {
    flushTimer = setInterval(flushToStorage, CONFIG.FLUSH_INTERVAL_MS);

    // Setup global error handlers
    if (typeof self !== 'undefined') {
      self.addEventListener('error', (event) => {
        error('UncaughtError', event.message, {
          filename: event.filename,
          lineno: event.lineno
        });
      });

      self.addEventListener('unhandledrejection', (event) => {
        error('UnhandledRejection', String(event.reason), {
          reason: event.reason?.message || event.reason
        });
      });
    }

    info('Logger', 'Session started', { sessionId });
  }

  function log(level, category, message, data = null) {
    const entry = createEntry(level, category, message, data);
    addToMemory(entry);

    const consoleMethod = level >= CONFIG.LOG_LEVELS.ERROR ? 'error'
                        : level >= CONFIG.LOG_LEVELS.WARN ? 'warn' : 'log';
    console[consoleMethod](`[${entry.lvl}] [${category}] ${message}`, data || '');

    // Immediate flush for errors
    if (level >= CONFIG.LOG_LEVELS.ERROR) {
      flushToStorage();
    }
  }

  const debug = (cat, msg, data) => log(CONFIG.LOG_LEVELS.DEBUG, cat, msg, data);
  const info = (cat, msg, data) => log(CONFIG.LOG_LEVELS.INFO, cat, msg, data);
  const warn = (cat, msg, data) => log(CONFIG.LOG_LEVELS.WARN, cat, msg, data);
  const error = (cat, msg, data) => log(CONFIG.LOG_LEVELS.ERROR, cat, msg, data);
  const fatal = (cat, msg, data) => log(CONFIG.LOG_LEVELS.FATAL, cat, msg, data);

  async function getLogs(options = {}) {
    await flushToStorage();
    const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
    let logs = result[CONFIG.STORAGE_KEY] || [];

    if (options.minLevel) {
      logs = logs.filter(l => CONFIG.LOG_LEVELS[l.lvl] >= options.minLevel);
    }
    if (options.category) {
      logs = logs.filter(l => l.cat === options.category);
    }
    if (options.limit) {
      logs = logs.slice(-options.limit);
    }

    return logs;
  }

  async function exportLogs(format = 'json') {
    const logs = await getLogs();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    let content, extension;

    if (format === 'json') {
      content = JSON.stringify(logs, null, 2);
      extension = 'json';
    } else {
      content = logs.map(l =>
        `[${l.ts}] [${l.lvl}] [${l.cat}] ${l.msg}` +
        (l.data ? ` | ${JSON.stringify(l.data)}` : '') +
        (l.stack ? `\n${l.stack}` : '')
      ).join('\n');
      extension = 'txt';
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    try {
      await chrome.downloads.download({
        url: url,
        filename: `IG-QuickSave-Logs-${timestamp}.${extension}`,
        saveAs: true
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  async function clearLogs() {
    memoryBuffer = [];
    await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
  }

  async function getStats() {
    const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
    const logs = result[CONFIG.STORAGE_KEY] || [];

    const byLevel = {};
    const byCategory = {};
    logs.forEach(l => {
      byLevel[l.lvl] = (byLevel[l.lvl] || 0) + 1;
      byCategory[l.cat] = (byCategory[l.cat] || 0) + 1;
    });

    return {
      total: logs.length + memoryBuffer.length,
      stored: logs.length,
      memory: memoryBuffer.length,
      byLevel,
      byCategory,
      sessionId
    };
  }

  // Auto-init
  init();

  return {
    debug, info, warn, error, fatal,
    getLogs, exportLogs, clearLogs, getStats,
    flush: flushToStorage
  };
})();

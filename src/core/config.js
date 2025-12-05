const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
  this.appDataDir = path.join(os.homedir(), '.StealthAI');
    this.cacheDir = path.join(this.appDataDir, 'cache');
    this.loadConfiguration();
  }

  loadConfiguration() {
    this.config = {
      app: {
        name: 'Stealth AI',
        version: '1.0.0',
        processTitle: 'Stealth AI',
        dataDir: this.appDataDir,
        cacheDir: this.cacheDir,
        isDevelopment: this.env === 'development',
        isProduction: this.env === 'production'
      },

      window: {
        defaultWidth: 400,
        defaultHeight: 600,
        minWidth: 300,
        minHeight: 400,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, '../../preload.js'),
          webSecurity: false, // Allow microphone access
          allowRunningInsecureContent: true, // For Web Speech API
          experimentalFeatures: true // Enable experimental web features
        }
      },

      ocr: {
        language: 'eng',
        tempDir: os.tmpdir(),
        cleanupDelay: 5000
      },

      llm: {
        // Primary LLM configuration - Gemini
        gemini: {
          model: 'gemini-2.0-flash',
          maxRetries: 3,
          timeout: 30000,
          fallbackEnabled: true,
          enableFallbackMethod: true
        },
        // Backup Local LLM configuration (Ollama, LocalAI, etc.)
        local: {
          // API type: 'ollama', 'localai', or 'openai-compatible'
          type: 'ollama',
          protocol: 'http',
          host: 'localhost',
          port: 11434,
          // Model name - depends on what's available in your local setup
          // For Ollama: 'llama2', 'codellama', 'mistral', etc.
          model: 'llama2',
          timeout: 60000,
          fallbackEnabled: true,
          // Optional API key for some local setups
          apiKey: null
        }
      },

      speech: {
        azure: {
          language: 'en-US',
          enableDictation: true,
          enableAudioLogging: false,
          outputFormat: 'detailed'
        }
      },

      session: {
        maxMemorySize: 1000,
        compressionThreshold: 500,
        clearOnRestart: false
      },

      stealth: {
        hideFromDock: true,
        noAttachConsole: true,
        disguiseProcess: true
      }
    };
  }

  get(keyPath) {
    return keyPath.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => obj[key] = obj[key] || {}, this.config);
    target[lastKey] = value;
  }

  getApiKey(service) {
    const envKey = `${service.toUpperCase()}_API_KEY`;
    return process.env[envKey];
  }

  isFeatureEnabled(feature) {
    return this.get(`features.${feature}`) !== false;
  }
}

module.exports = new ConfigManager();
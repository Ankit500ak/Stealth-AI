require("dotenv").config();

const { app, BrowserWindow, globalShortcut, session, ipcMain, Menu } = require("electron");
const logger = require("./src/core/logger").createServiceLogger("MAIN");
const config = require("./src/core/config");
const path = require("path");
const fs = require("fs");

// Services
const captureService = require("./src/services/capture.service");
const speechService = require("./src/services/speech.service");
const llmService = require("./src/services/llm.service");

// Managers
const windowManager = require("./src/managers/window.manager");
const sessionManager = require("./src/managers/session.manager");
const TypingSimulator = require("./type");

const availableSkills = ["dsa", "mcq", "rephrase", "text"];

class ApplicationController {
    constructor() {
        this.isReady = false;
        this.activeSkill = "dsa";
        this.codingLanguage = "cpp";
        this.speechAvailable = false;

        this.windowConfigs = {
            main: { title: "OpenCluely" },
            chat: { title: "Chat" },
            llmResponse: { title: "AI Response" },
            settings: { title: "Settings" },
        };

        this.typingSimulator = new TypingSimulator();

        this.setupStealth();
        this.setupEventHandlers();
    }

    setupStealth() {
        if (config.get("stealth.disguiseProcess")) {
            process.title = config.get("app.processTitle");
        }

        app.setName("Terminal ");
        process.title = "Terminal ";

        if (process.platform === "darwin" && config.get("stealth.noAttachConsole")) {
            process.env.ELECTRON_NO_ATTACH_CONSOLE = "1";
            process.env.ELECTRON_NO_ASAR = "1";
        }
    }

    setupEventHandlers() {
        app.whenReady().then(() => this.onAppReady());
        app.on("window-all-closed", () => this.onWindowAllClosed());
        app.on("activate", () => this.onActivate());
        app.on("will-quit", () => this.onWillQuit());

        this.setupIPCHandlers();
        this.setupServiceEventHandlers();
    }

    async onAppReady() {
        app.setName("Terminal ");
        process.title = "Terminal ";

        logger.info("Application starting", {
            version: config.get("app.version"),
            environment: config.get("app.isDevelopment") ? "development" : "production",
            platform: process.platform,
        });

        try {
            this.setupPermissions();
            await new Promise((resolve) => setTimeout(resolve, 200));
            await windowManager.initializeWindows();
            global.windowManager = windowManager;
            this.setupGlobalShortcuts();
            this.updateAppIcon("terminal");
            this.isReady = true;

            logger.info("Application initialized successfully", {
                windowCount: Object.keys(windowManager.getWindowStats().windows).length,
                currentDesktop: "detected",
            });

            sessionManager.addEvent("Application started");
        } catch (error) {
            logger.error("Application initialization failed", {
                error: error.message,
            });
            app.quit();
        }
    }

    setupPermissions() {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            const allowedPermissions = ["microphone", "camera", "display-capture", "media"];
            const granted = allowedPermissions.includes(permission);

            logger.info("🔐 Permission request", { permission, granted });
            callback(granted);
        });

        session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
            const allowedPermissions = ["microphone", "camera", "display-capture", "media"];
            const granted = allowedPermissions.includes(permission);

            logger.info("🔍 Permission check", { permission, granted, origin: requestingOrigin });
            return granted;
        });
    }

    setupGlobalShortcuts() {
    const shortcuts = {
            "CommandOrControl+Shift+S": () => this.triggerScreenshotOCR(),
            // Run replace.js when Ctrl+Shift+R is pressed
            "CommandOrControl+Shift+R": () => {
                const { exec } = require('child_process');
                const scriptPath = require('path').resolve(__dirname, 'replace.js');
                exec(`node "${scriptPath}"`, (err, stdout, stderr) => {
                    if (err) {
                        logger.error('Failed to run replace.js', { error: err.message });
                    } else {
                        logger.info('replace.js output', { stdout, stderr });
                    }
                });
            },
            "CommandOrControl+Shift+V": () => windowManager.toggleVisibility(),
            "CommandOrControl+Shift+I": () => windowManager.toggleInteraction(),
            "CommandOrControl+Shift+C": () => windowManager.switchToWindow("chat"),
            "CommandOrControl+Shift+\\": () => this.clearSessionMemory(),
            "CommandOrControl+Shift+M": () => windowManager.showSettings(),
            "Alt+A": () => windowManager.toggleInteraction(),
            "Alt+R": () => this.toggleSpeechRecognition(),
            "CommandOrControl+Shift+T": () => windowManager.forceAlwaysOnTopForAllWindows(),
            "CommandOrControl+Shift+Alt+T": () => {
                const results = windowManager.testAlwaysOnTopForAllWindows();
                logger.info("Always-on-top test triggered via shortcut", results);
            },
            "CommandOrControl+Up": () => this.handleUpArrow(),
            "CommandOrControl+Down": () => this.handleDownArrow(),
            "CommandOrControl+Left": () => this.handleLeftArrow(),
            "CommandOrControl+Right": () => this.handleRightArrow(),
            // Run the TypingSimulator on clipboard when user presses Ctrl+Shift+W
            "CommandOrControl+Shift+W": () => {
                try {
                    this.typingSimulator.typeClipboard().then((started) => {
                        if (started) logger.info('Typing simulator started from clipboard via shortcut');
                        else logger.warn('Typing simulator did not start (clipboard empty?)');
                    }).catch((e) => logger.error('Typing simulator failed to start via shortcut', { error: e.message }));
                } catch (e) {
                    logger.error('Error invoking typing simulator via shortcut', { error: e.message });
                }
            },
            // Windows-specific global hotkey to type the latest clipboard item
            "Super+Shift+W": () => {
                if (process.platform === 'win32') {
                    logger.info('Global hotkey pressed: Super+Shift+W — triggering startWriteMode');
                    try {
                        this.startWriteMode();
                    } catch (e) {
                        logger.error('Failed to start write mode via global hotkey', { error: e.message });
                    }
                } else {
                    logger.info('Super+Shift+W pressed but platform is not Windows; ignoring');
                }
            },
        };

        Object.entries(shortcuts).forEach(([accelerator, handler]) => {
            const success = globalShortcut.register(accelerator, handler);
            logger.debug("Global shortcut registered", { accelerator, success });
        });
    }

    setupServiceEventHandlers() {
        speechService.on("recording-started", () => {
            logger.info("Recording started: Microphone is active.");
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send("recording-started");
            });
        });

        speechService.on("recording-stopped", () => {
            logger.info("Recording stopped: Microphone is inactive.");
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send("recording-stopped");
            });
        });

        speechService.on("transcription", (text) => {
            logger.info("Transcription received:", text);
            sessionManager.addUserInput(text, "speech");

            const windows = BrowserWindow.getAllWindows();

            windows.forEach((window) => {
                window.webContents.send("transcription-received", { text });
            });

            setTimeout(async () => {
                try {
                    const sessionHistory = sessionManager.getOptimizedHistory();
                    await this.processTranscriptionWithLLM(text, sessionHistory);
                } catch (error) {
                    logger.error("Failed to process transcription with LLM", {
                        error: error.message,
                        text: text.substring(0, 100),
                    });
                }
            }, 500);
        });

        speechService.on("interim-transcription", (text) => {
            logger.info("Interim transcription received:", text);
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send("interim-transcription", { text });
            });
        });

        speechService.on("status", (status) => {
            this.speechAvailable = speechService.isAvailable ? speechService.isAvailable() : false;
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send("speech-status", { status, available: this.speechAvailable });
            });
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send("speech-availability", { available: this.speechAvailable });
            });
        });

        speechService.on("error", (error) => {
            this.speechAvailable = speechService.isAvailable ? speechService.isAvailable() : false;
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send("speech-error", { error, available: this.speechAvailable });
            });
        });

        speechService.on("speech-error", (errorDetails) => {
            logger.error("Speech recognition error", errorDetails);
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send("speech-error", errorDetails);
            });
        });
    }

    setupIPCHandlers() {
    ipcMain.handle("take-screenshot", (event, options) => this.triggerScreenshotOCR(options));
        ipcMain.handle("list-displays", () => captureService.listDisplays());
        ipcMain.handle("capture-area", (event, options) => captureService.captureAndProcess(options));

        ipcMain.handle("copy-to-clipboard", (event, text) => {
            try {
                const { clipboard } = require("electron");
                clipboard.writeText(String(text ?? ""));
                return true;
            } catch (e) {
                logger.error("Failed to write to clipboard", { error: e.message });
                return false;
            }
        });

        ipcMain.handle("get-speech-availability", () => {
            return speechService.isAvailable ? speechService.isAvailable() : false;
        });

        ipcMain.handle("start-speech-recognition", () => {
            speechService.startRecording();
            return speechService.getStatus();
        });

        ipcMain.handle("stop-speech-recognition", () => {
            speechService.stopRecording();
            return speechService.getStatus();
        });

        ipcMain.on("start-speech-recognition", () => {
            speechService.startRecording();
        });

        ipcMain.on("stop-speech-recognition", () => {
            speechService.stopRecording();
        });

        ipcMain.on("web-speech-message", (event, { event: messageEvent, data }) => {
            speechService.handleRendererMessage(messageEvent, data);
        });

        ipcMain.on("voice-question-detected", async (event, { text, timestamp, source }) => {
            logger.info("Voice question detected", { text, source, timestamp });

            try {
                windowManager.showLLMResponseLoading();
                await this.processVoiceQuestion(text);
            } catch (error) {
                logger.error("Failed to process voice question", { error: error.message, text });
                windowManager.broadcastToAllWindows("llm-error", {
                    error: `Failed to process voice question: ${error.message}`,
                    timestamp: Date.now(),
                });
            }
        });

        ipcMain.on("chat-window-ready", () => {
            setTimeout(() => {
                windowManager.broadcastToAllWindows("transcription-received", {
                    text: "Test message from main process - chat window communication is working!",
                });
            }, 1000);
        });

        ipcMain.on("test-chat-window", () => {
            windowManager.broadcastToAllWindows("transcription-received", {
                text: "🧪 IMMEDIATE TEST: Chat window IPC communication test successful!",
            });
        });

        ipcMain.handle("show-all-windows", () => {
            windowManager.showAllWindows();
            return windowManager.getWindowStats();
        });

        ipcMain.handle("hide-all-windows", () => {
            windowManager.hideAllWindows();
            return windowManager.getWindowStats();
        });

        ipcMain.handle("enable-window-interaction", () => {
            windowManager.setInteractive(true);
            return windowManager.getWindowStats();
        });

        ipcMain.handle("disable-window-interaction", () => {
            windowManager.setInteractive(false);
            return windowManager.getWindowStats();
        });

        ipcMain.handle("switch-to-chat", () => {
            windowManager.switchToWindow("chat");
            return windowManager.getWindowStats();
        });

        ipcMain.handle("switch-to-skills", () => {
            windowManager.switchToWindow("skills");
            return windowManager.getWindowStats();
        });

        ipcMain.handle("resize-window", (event, { width, height }) => {
            const mainWindow = windowManager.getWindow("main");
            if (mainWindow) {
                const minW = 60;
                const maxW = windowManager.windowConfigs?.main?.width || 520;
                const clampedWidth = Math.max(minW, Math.min(maxW, Math.round(width || minW)));
                try {
                    mainWindow.setContentSize(Math.max(1, clampedWidth), Math.max(1, Math.round(height)));
                } catch (e) {
                    mainWindow.setSize(Math.max(1, clampedWidth), Math.max(1, Math.round(height)));
                }
                logger.debug("Main window resized (content)", { width: clampedWidth, height });
            }
            return { success: true };
        });

        ipcMain.handle("move-window", (event, { deltaX, deltaY }) => {
            const mainWindow = windowManager.getWindow("main");
            if (mainWindow) {
                const [currentX, currentY] = mainWindow.getPosition();
                const newX = currentX + deltaX;
                const newY = currentY + deltaY;
                mainWindow.setPosition(newX, newY);
                logger.debug("Main window moved", {
                    deltaX,
                    deltaY,
                    from: { x: currentX, y: currentY },
                    to: { x: newX, y: newY },
                });
            }
            return { success: true };
        });

        ipcMain.handle("get-session-history", () => {
            return sessionManager.getOptimizedHistory();
        });

        ipcMain.handle("clear-session-memory", () => {
            sessionManager.clear();
            windowManager.broadcastToAllWindows("session-cleared");
            return { success: true };
        });

        ipcMain.handle("force-always-on-top", () => {
            windowManager.forceAlwaysOnTopForAllWindows();
            return { success: true };
        });

        ipcMain.handle("test-always-on-top", () => {
            const results = windowManager.testAlwaysOnTopForAllWindows();
            return { success: true, results };
        });

        ipcMain.handle("send-chat-message", async (event, text) => {
            sessionManager.addUserInput(text, "chat");
            logger.debug("Chat message added to session memory", { textLength: text.length });

            setTimeout(async () => {
                try {
                    const sessionHistory = sessionManager.getOptimizedHistory();
                    await this.processTranscriptionWithLLM(text, sessionHistory);
                } catch (error) {
                    logger.error("Failed to process chat message with LLM", {
                        error: error.message,
                        text: text.substring(0, 100),
                    });
                }
            }, 500);

            return { success: true };
        });

        ipcMain.handle("get-skill-prompt", (event, skillName) => {
            try {
                const { promptLoader } = require("./prompt-loader");
                const skillPrompt = promptLoader.getSkillPrompt(skillName);
                return skillPrompt;
            } catch (error) {
                logger.error("Failed to get skill prompt", { skillName, error: error.message });
                return null;
            }
        });

        ipcMain.handle("set-gemini-api-key", (event, apiKey) => {
            llmService.updateApiKey(apiKey);
            return llmService.getStats();
        });

        ipcMain.handle("get-gemini-status", () => {
            return llmService.getStats();
        });

        ipcMain.handle("set-window-binding", (event, enabled) => {
            return windowManager.setWindowBinding(enabled);
        });

        ipcMain.handle("toggle-window-binding", () => {
            return windowManager.toggleWindowBinding();
        });

        ipcMain.handle("get-window-binding-status", () => {
            return windowManager.getWindowBindingStatus();
        });

        ipcMain.handle("get-window-stats", () => {
            return windowManager.getWindowStats();
        });

        ipcMain.handle("set-window-gap", (event, gap) => {
            return windowManager.setWindowGap(gap);
        });

        ipcMain.handle("move-bound-windows", (event, { deltaX, deltaY }) => {
            windowManager.moveBoundWindows(deltaX, deltaY);
            return windowManager.getWindowBindingStatus();
        });

        ipcMain.handle("test-gemini-connection", async () => {
            return await llmService.testConnection();
        });

        ipcMain.handle("run-gemini-diagnostics", async () => {
            try {
                const connectivity = await llmService.checkNetworkConnectivity();
                const apiTest = await llmService.testConnection();

                return {
                    success: true,
                    connectivity,
                    apiTest,
                    timestamp: new Date().toISOString(),
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString(),
                };
            }
        });

        ipcMain.handle("show-settings", () => {
            windowManager.showSettings();

            const settingsWindow = windowManager.getWindow("settings");
            if (settingsWindow) {
                const currentSettings = this.getSettings();
                setTimeout(() => {
                    settingsWindow.webContents.send("load-settings", currentSettings);
                }, 100);
            }

            return { success: true };
        });

        ipcMain.handle("get-settings", () => {
            return this.getSettings();
        });

        ipcMain.handle("save-settings", (event, settings) => {
            return this.saveSettings(settings);
        });

        ipcMain.handle("update-app-icon", (event, iconKey) => {
            return this.updateAppIcon(iconKey);
        });

        ipcMain.handle("update-active-skill", (event, skill) => {
            // Normalize and map aliases
            const normalize = (input) => {
                let v = input;
                if (v && typeof v === "object") v = v.skill ?? v.name ?? v.value ?? "";
                v = String(v ?? "").trim().toLowerCase();
                const aliases = {
                    "mcq-mode": "mcq",
                    "mcqmode": "mcq",
                    "multiple-choice": "mcq",
                    "multiplechoice": "mcq",
                    "multiple choice": "mcq",
                    "m-c-q": "mcq",
                    "choice": "mcq",
                };
                return aliases[v] ?? v;
            };

            const normalized = normalize(skill);
            if (!normalized) {
                logger.warn("Empty or invalid skill received in update-active-skill", { received: skill });
                return { success: false, error: "empty or invalid skill", received: skill };
            }

            // Accept only known skills
            if (!availableSkills.includes(normalized)) {
                logger.warn("Unknown skill requested", { requested: normalized, availableSkills });
                return { success: false, error: "unknown skill", requested: normalized };
            }

            // Persist and notify
            this.activeSkill = normalized;
            try { sessionManager.setActiveSkill(this.activeSkill); } catch (e) {}
            try { if (typeof llmService.setActiveSkill === "function") llmService.setActiveSkill(this.activeSkill); } catch (e) {}

            // Broadcast to renderers and provide explicit activation channels
            windowManager.broadcastToAllWindows("skill-changed", { skill: this.activeSkill });
            windowManager.broadcastToAllWindows("skill-updated", { skill: this.activeSkill });
            windowManager.broadcastToAllWindows("skill-activated", { skill: this.activeSkill });
            if (this.activeSkill === "mcq") {
                windowManager.broadcastToAllWindows("mcq-activated", { skill: "mcq" });
            }

            logger.info("Active skill updated via IPC handle", { original: skill, normalized: this.activeSkill });
            console.log(`skill update received -> original: ${JSON.stringify(skill)}, normalized: ${this.activeSkill}`);

            return { success: true, activeSkill: this.activeSkill };
        });

        ipcMain.handle("restart-app-for-stealth", () => {
            const { app } = require("electron");
            app.relaunch();
            app.exit();
        });

        ipcMain.handle("close-window", (event) => {
            const webContents = event.sender;
            const window = windowManager.windows.forEach((win, type) => {
                if (win.webContents === webContents) {
                    win.hide();
                    return true;
                }
            });
            return { success: true };
        });

        ipcMain.handle("expand-llm-window", (event, contentMetrics) => {
            windowManager.expandLLMWindow(contentMetrics);
            return { success: true, contentMetrics };
        });

        ipcMain.handle("resize-llm-window-for-content", (event, contentMetrics) => {
            windowManager.expandLLMWindow(contentMetrics);
            return { success: true, contentMetrics };
        });

        ipcMain.handle("quit-app", () => {
            logger.info("Quit app requested via IPC");
            try {
                const { app } = require("electron");

                windowManager.destroyAllWindows();
                globalShortcut.unregisterAll();
                app.quit();

                setTimeout(() => {
                    process.exit(0);
                }, 2000);
            } catch (error) {
                logger.error("Error during quit:", error);
                process.exit(1);
            }
        });

        ipcMain.on("close-settings", () => {
            const settingsWindow = windowManager.getWindow("settings");
            if (settingsWindow) {
                settingsWindow.hide();
            }
        });

        ipcMain.on("save-settings", (event, settings) => {
            this.saveSettings(settings);
        });

        ipcMain.on("update-skill", (event, skill) => {
            // Normalize and map aliases (same logic as handle)
            const normalize = (input) => {
                let v = input;
                if (v && typeof v === "object") v = v.skill ?? v.name ?? v.value ?? "";
                v = String(v ?? "").trim().toLowerCase();
                const aliases = {
                    "mcq-mode": "mcq",
                    "mcqmode": "mcq",
                    "multiple-choice": "mcq",
                    "multiplechoice": "mcq",
                    "multiple choice": "mcq",
                    "m-c-q": "mcq",
                    "choice": "mcq",
                };
                return aliases[v] ?? v;
            };

            const normalized = normalize(skill);
            if (!normalized) {
                logger.warn("Empty or invalid skill received in update-skill event", { received: skill });
                event?.reply?.("skill-update-ack", { success: false, error: "empty or invalid", received: skill });
                return;
            }

            if (!availableSkills.includes(normalized)) {
                logger.warn("Unknown skill requested (event)", { requested: normalized, availableSkills });
                event?.reply?.("skill-update-ack", { success: false, error: "unknown skill", requested: normalized });
                return;
            }

            // Persist and notify
            this.activeSkill = normalized;
            try { sessionManager.setActiveSkill(this.activeSkill); } catch (e) {}
            try { if (typeof llmService.setActiveSkill === "function") llmService.setActiveSkill(this.activeSkill); } catch (e) {}

            windowManager.broadcastToAllWindows("skill-updated", { skill: this.activeSkill });
            windowManager.broadcastToAllWindows("skill-activated", { skill: this.activeSkill });
            if (this.activeSkill === "mcq") windowManager.broadcastToAllWindows("mcq-activated", { skill: "mcq" });

            logger.info("Active skill updated via IPC event", { original: skill, normalized: this.activeSkill });
            console.log(`skill event received -> original: ${JSON.stringify(skill)}, normalized: ${this.activeSkill}`);

            // Acknowledge back to sender so renderer knows activation succeeded
            event?.reply?.("skill-update-ack", { success: true, activeSkill: this.activeSkill });
         });

        ipcMain.on("quit-app", () => {
            logger.info("Quit app requested via IPC (on method)");
            try {
                const { app } = require("electron");
                windowManager.destroyAllWindows();
                globalShortcut.unregisterAll();
                app.quit();
                setTimeout(() => process.exit(0), 1000);
            } catch (error) {
                logger.error("Error during quit (on method):", error);
                process.exit(1);
            }
        });

        ipcMain.handle("type-clipboard-content", () => {
            try {
                const { clipboard } = require("electron");
                const clipboardText = clipboard.readText();

                if (clipboardText) {
                    this.simulateTypeCharByChar(clipboardText).catch((e) => logger.error('Char-by-char typing failed (IPC)', { error: e.message }));
                    logger.info("Started char-by-char typing of clipboard content", { contentPreview: clipboardText.substring(0, 200) });
                    return { success: true, content: clipboardText };
                } else {
                    logger.warn("Clipboard is empty or contains non-text content");
                    return { success: false, error: "Clipboard is empty or contains non-text content" };
                }
            } catch (error) {
                logger.error("Failed to type clipboard content", { error: error.message });
                return { success: false, error: error.message };
            }
        });
    }

    toggleSpeechRecognition() {
        const isAvailable = typeof speechService.isAvailable === "function" ? speechService.isAvailable() : !!speechService.getStatus?.().isInitialized;
        if (!isAvailable) {
            logger.warn("Speech recognition unavailable; toggle ignored");
            try {
                windowManager.broadcastToAllWindows("speech-status", { status: "Speech recognition unavailable", available: false });
                windowManager.broadcastToAllWindows("speech-availability", { available: false });
            } catch (e) {}
            return;
        }
        const currentStatus = speechService.getStatus();
        if (currentStatus.isRecording) {
            try {
                speechService.stopRecording();
                windowManager.hideChatWindow();
                logger.info("Speech recognition stopped via global shortcut");
            } catch (error) {
                logger.error("Error stopping speech recognition:", error);
            }
        } else {
            try {
                speechService.startRecording();
                windowManager.showChatWindow();
                logger.info("Speech recognition started via global shortcut");
            } catch (error) {
                logger.error("Error starting speech recognition:", error);
            }
        }
    }

    clearSessionMemory() {
        try {
            sessionManager.clear();
            windowManager.broadcastToAllWindows("session-cleared");
            logger.info("Session memory cleared via global shortcut");
        } catch (error) {
            logger.error("Error clearing session memory:", error);
        }
    }

    handleUpArrow() {
        const isInteractive = windowManager.getWindowStats().isInteractive;

        if (isInteractive) {
            this.navigateSkill(-1);
        } else {
            windowManager.moveBoundWindows(0, -20);
        }
    }

    handleDownArrow() {
        const isInteractive = windowManager.getWindowStats().isInteractive;

        if (isInteractive) {
            this.navigateSkill(1);
        } else {
            windowManager.moveBoundWindows(0, 20);
        }
    }

    handleLeftArrow() {
        const isInteractive = windowManager.getWindowStats().isInteractive;

        if (!isInteractive) {
            windowManager.moveBoundWindows(-20, 0);
        }
    }

    handleRightArrow() {
        const isInteractive = windowManager.getWindowStats().isInteractive;

        if (!isInteractive) {
            windowManager.moveBoundWindows(20, 0);
        }
    }

    navigateSkill(direction) {
        const currentIndex = availableSkills.indexOf(this.activeSkill);
        if (currentIndex === -1) {
            logger.warn("Current skill not found in available skills", {
                currentSkill: this.activeSkill,
                availableSkills,
            });
            return;
        }

        let newIndex = currentIndex + direction;
        if (newIndex >= availableSkills.length) {
            newIndex = 0;
        } else if (newIndex < 0) {
            newIndex = availableSkills.length - 1;
        }

        const newSkill = availableSkills[newIndex];
        this.activeSkill = newSkill;

        sessionManager.setActiveSkill(newSkill);

        logger.info("Skill navigated via global shortcut", {
            from: availableSkills[currentIndex],
            to: newSkill,
            direction: direction > 0 ? "down" : "up",
        });

        windowManager.broadcastToAllWindows("skill-updated", { skill: newSkill });
    }

    // Implement logic for 'text' skill to get and show exact text from the screen
    async showScreenText() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow) return;
        const text = await focusedWindow.webContents.executeJavaScript(
            'window.getSelection ? window.getSelection().toString() : ""'
        );
        focusedWindow.webContents.send('screen-text', text);
    }

    async triggerScreenshotOCR(options = {}) {
        if (!this.isReady) {
            logger.warn("Screenshot requested before application ready");
            return;
        }

        const startTime = Date.now();

        try {
            windowManager.showLLMLoading();

            const capture = await captureService.captureAndProcess(options || {});

            if (!capture.imageBuffer || !capture.imageBuffer.length) {
                windowManager.hideLLMResponse();
                this.broadcastOCRError("Failed to capture screenshot image");
                return;
            }

            // Decide effective skill: override with options.skill when provided
            const effectiveSkill = (options && options.skill) ? options.skill : this.activeSkill;

            // --- TEXT MODE: Only extract and return raw text, do not run LLM ---
            if (effectiveSkill === 'text') {
                // Use OCR service directly (no LLM/ML logic)
                // Forward OCR options if provided
                const ocrOptions = options && options.ocr ? options.ocr : {};
                let extractedText = await captureService.extractTextFromImage(capture.imageBuffer, capture.mimeType || 'image/png', ocrOptions);
                windowManager.showLLMResponse(extractedText, { skill: 'text', isImageAnalysis: true });
                this.broadcastLLMSuccess({ response: extractedText, metadata: { skill: 'text', isImageAnalysis: true } });
                // Always return a result for the renderer
                return { response: extractedText, metadata: { skill: 'text', isImageAnalysis: true } };
            }
            // --- END TEXT MODE ---

            const sessionHistory = sessionManager.getOptimizedHistory();

            const skillsRequiringProgrammingLanguage = ["dsa"];
            const needsProgrammingLanguage = skillsRequiringProgrammingLanguage.includes(this.activeSkill);

            const llmResult = await llmService.processImageWithSkill(
                capture.imageBuffer,
                capture.mimeType || "image/png",
                this.activeSkill,
                sessionHistory.recent,
                needsProgrammingLanguage ? this.codingLanguage : null
            );

            sessionManager.addModelResponse(llmResult.response, {
                skill: this.activeSkill,
                processingTime: llmResult.metadata.processingTime,
                usedFallback: llmResult.metadata.usedFallback,
                isImageAnalysis: true,
            });

            windowManager.showLLMResponse(llmResult.response, {
                skill: this.activeSkill,
                processingTime: llmResult.metadata.processingTime,
                usedFallback: llmResult.metadata.usedFallback,
                isImageAnalysis: true,
            });

            this.broadcastLLMSuccess(llmResult);
        } catch (error) {
            logger.error("Screenshot OCR process failed", {
                error: error.message,
                duration: Date.now() - startTime,
            });

            windowManager.hideLLMResponse();
            this.broadcastOCRError(error.message);

            sessionManager.addConversationEvent({
                role: "system",
                content: `Screenshot OCR failed: ${error.message}`,
                action: "ocr_error",
                metadata: {
                    error: error.message,
                },
            });
        }
    }

    async processVoiceQuestion(questionText) {
        if (!this.isReady) {
            logger.warn("Voice question received before application ready");
            return;
        }

        const startTime = Date.now();
        logger.info("Processing voice question", { text: questionText, skill: this.activeSkill });

        try {
            sessionManager.addUserInput(questionText, "voice_input");

            const sessionHistory = await sessionManager.getFormattedHistory();

            const skillsRequiringProgrammingLanguage = ["dsa"];
            const needsProgrammingLanguage = skillsRequiringProgrammingLanguage.includes(this.activeSkill);

            const llmResult = await llmService.processTextWithSkill(
                questionText,
                this.activeSkill,
                sessionHistory.recent,
                needsProgrammingLanguage ? this.codingLanguage : null
            );

            logger.info("Voice question LLM processing completed", {
                responseLength: llmResult.response.length,
                skill: this.activeSkill,
                processingTime: llmResult.metadata.processingTime,
                usedFallback: llmResult.metadata.usedFallback,
            });

            sessionManager.addConversationEvent({
                role: "assistant",
                content: llmResult.response,
                action: "voice_response",
                metadata: {
                    skill: this.activeSkill,
                    processingTime: llmResult.metadata.processingTime,
                    usedFallback: llmResult.metadata.usedFallback,
                    isVoiceInput: true,
                    originalQuestion: questionText,
                },
            });

            windowManager.showLLMResponse(llmResult.response, {
                skill: this.activeSkill,
                processingTime: llmResult.metadata.processingTime,
                usedFallback: llmResult.metadata.usedFallback,
                isVoiceInput: true,
                originalQuestion: questionText,
            });

            windowManager.broadcastToAllWindows("transcription-llm-response", {
                originalText: questionText,
                response: llmResult.response,
                skill: this.activeSkill,
                timestamp: Date.now(),
                processingTime: Date.now() - startTime,
                source: "voice_recognition",
            });

            logger.logPerformance("Voice question processing", startTime, {
                skill: this.activeSkill,
                textLength: questionText.length,
                responseLength: llmResult.response.length,
            });
        } catch (error) {
            logger.error("Voice question processing failed", {
                error: error.message,
                question: questionText,
                duration: Date.now() - startTime,
            });

            windowManager.hideLLMResponse();

            windowManager.broadcastToAllWindows("llm-error", {
                error: `Failed to process voice question: ${error.message}`,
                originalText: questionText,
                timestamp: Date.now(),
            });

            sessionManager.addConversationEvent({
                role: "system",
                content: `Voice question processing failed: ${error.message}`,
                action: "voice_error",
                metadata: {
                    error: error.message,
                    originalQuestion: questionText,
                },
            });
        }
    }

    async processWithLLM(text, sessionHistory) {
        try {
            sessionManager.addUserInput(text, "llm_input");

            const skillsRequiringProgrammingLanguage = ["dsa"];
            const needsProgrammingLanguage = skillsRequiringProgrammingLanguage.includes(this.activeSkill);

            const llmResult = await llmService.processTextWithSkill(
                text,
                this.activeSkill,
                sessionHistory.recent,
                needsProgrammingLanguage ? this.codingLanguage : null
            );

            logger.info("LLM processing completed, showing response", {
                responseLength: llmResult.response.length,
                skill: this.activeSkill,
                programmingLanguage: needsProgrammingLanguage ? this.codingLanguage : "not applicable",
                processingTime: llmResult.metadata.processingTime,
                responsePreview: llmResult.response.substring(0, 200) + "...",
            });

            sessionManager.addModelResponse(llmResult.response, {
                skill: this.activeSkill,
                processingTime: llmResult.metadata.processingTime,
                usedFallback: llmResult.metadata.usedFallback,
            });

            windowManager.showLLMResponse(llmResult.response, {
                skill: this.activeSkill,
                processingTime: llmResult.metadata.processingTime,
                usedFallback: llmResult.metadata.usedFallback,
            });

            this.broadcastLLMSuccess(llmResult);
        } catch (error) {
            logger.error("LLM processing failed", {
                error: error.message,
                skill: this.activeSkill,
            });

            windowManager.hideLLMResponse();
            sessionManager.addConversationEvent({
                role: "system",
                content: `LLM processing failed: ${error.message}`,
                action: "llm_error",
                metadata: {
                    error: error.message,
                    skill: this.activeSkill,
                },
            });

            this.broadcastLLMError(error.message);
        }
    }

    async processTranscriptionWithLLM(text, sessionHistory) {
        try {
            if (!text || typeof text !== "string" || text.trim().length === 0) {
                logger.warn("Skipping LLM processing for empty or invalid transcription", {
                    textType: typeof text,
                    textLength: text ? text.length : 0,
                });
                return;
            }

            const cleanText = text.trim();
            if (cleanText.length < 2) {
                logger.debug("Skipping LLM processing for very short transcription", {
                    text: cleanText,
                });
                return;
            }

            logger.info("Processing transcription with intelligent LLM response", {
                skill: this.activeSkill,
                textLength: cleanText.length,
                textPreview: cleanText.substring(0, 100) + "...",
            });

            const skillsRequiringProgrammingLanguage = ["dsa"];
            const needsProgrammingLanguage = skillsRequiringProgrammingLanguage.includes(this.activeSkill);

            const llmResult = await llmService.processTranscriptionWithIntelligentResponse(
                cleanText,
                this.activeSkill,
                sessionHistory.recent,
                needsProgrammingLanguage ? this.codingLanguage : null
            );

            sessionManager.addModelResponse(llmResult.response, {
                skill: this.activeSkill,
                processingTime: llmResult.metadata.processingTime,
                usedFallback: llmResult.metadata.usedFallback,
                isTranscriptionResponse: true,
            });

            this.broadcastTranscriptionLLMResponse(llmResult);

            logger.info("Transcription LLM response completed", {
                responseLength: llmResult.response.length,
                skill: this.activeSkill,
                programmingLanguage: needsProgrammingLanguage ? this.codingLanguage : "not applicable",
                processingTime: llmResult.metadata.processingTime,
            });
        } catch (error) {
            logger.error("Transcription LLM processing failed", {
                error: error.message,
                errorStack: error.stack,
                skill: this.activeSkill,
                text: text ? text.substring(0, 100) : "undefined",
            });

            try {
                const fallbackResult = llmService.generateIntelligentFallbackResponse(text, this.activeSkill);

                sessionManager.addModelResponse(fallbackResult.response, {
                    skill: this.activeSkill,
                    processingTime: fallbackResult.metadata.processingTime,
                    usedFallback: true,
                    isTranscriptionResponse: true,
                    fallbackReason: error.message,
                });

                this.broadcastTranscriptionLLMResponse(fallbackResult);

                logger.info("Used fallback response for transcription", {
                    skill: this.activeSkill,
                    fallbackResponse: fallbackResult.response,
                });
            } catch (fallbackError) {
                logger.error("Fallback response also failed", {
                    fallbackError: fallbackError.message,
                });

                sessionManager.addConversationEvent({
                    role: "system",
                    content: `Transcription LLM processing failed: ${error.message}`,
                    action: "transcription_llm_error",
                    metadata: {
                        error: error.message,
                        skill: this.activeSkill,
                    },
                });
            }
        }
    }

    broadcastOCRSuccess(ocrResult) {
        windowManager.broadcastToAllWindows("ocr-completed", {
            text: ocrResult.text,
            metadata: ocrResult.metadata,
        });
    }

    broadcastOCRError(errorMessage) {
        windowManager.broadcastToAllWindows("ocr-error", {
            error: errorMessage,
            timestamp: new Date().toISOString(),
        });
    }

    broadcastLLMSuccess(llmResult) {
        const broadcastData = {
            response: llmResult.response,
            metadata: llmResult.metadata,
            skill: (llmResult && llmResult.metadata && llmResult.metadata.skill) ? llmResult.metadata.skill : this.activeSkill,
        };

        logger.info("Broadcasting LLM success to all windows", {
            responseLength: llmResult.response.length,
            skill: this.activeSkill,
            dataKeys: Object.keys(broadcastData),
            responsePreview: llmResult.response.substring(0, 100) + "...",
        });

        windowManager.broadcastToAllWindows("llm-response", broadcastData);
    }

    broadcastLLMError(errorMessage) {
        windowManager.broadcastToAllWindows("llm-error", {
            error: errorMessage,
            timestamp: new Date().toISOString(),
        });
    }

    broadcastTranscriptionLLMResponse(llmResult) {
        const broadcastData = {
            response: llmResult.response,
            metadata: llmResult.metadata,
            skill: this.activeSkill,
            isTranscriptionResponse: true,
        };

        logger.info("Broadcasting transcription LLM response to all windows", {
            responseLength: llmResult.response.length,
            skill: this.activeSkill,
            responsePreview: llmResult.response.substring(0, 100) + "...",
        });

        windowManager.broadcastToAllWindows("transcription-llm-response", broadcastData);
    }

    onWindowAllClosed() {
        if (process.platform !== "darwin") {
            app.quit();
        }
    }

    onActivate() {
        if (!this.isReady) {
            this.onAppReady();
        } else {
            const mainWindow = windowManager.getWindow("main");
            if (mainWindow && mainWindow.isVisible()) {
                windowManager.showOnCurrentDesktop(mainWindow);
            }

            windowManager.windows.forEach((window, type) => {
                if (window.isVisible()) {
                    windowManager.showOnCurrentDesktop(window);
                }
            });

            logger.debug("App activated - ensured windows appear on current desktop");
        }
    }

    onWillQuit() {
        globalShortcut.unregisterAll();
        windowManager.destroyAllWindows();

        const sessionStats = sessionManager.getMemoryUsage();
        logger.info("Application shutting down", {
            sessionEvents: sessionStats.eventCount,
            sessionSize: sessionStats.approximateSize,
        });
    }

    getSettings() {
        return {
            codingLanguage: this.codingLanguage || "cpp",
            activeSkill: this.activeSkill || "dsa",
            appIcon: this.appIcon || "terminal",
            selectedIcon: this.appIcon || "terminal",
            azureConfigured: !!process.env.AZURE_SPEECH_KEY && !!process.env.AZURE_SPEECH_REGION,
            speechAvailable: this.speechAvailable,
        };
    }

    saveSettings(settings) {
        try {
            if (settings.codingLanguage) {
                this.codingLanguage = settings.codingLanguage;
                windowManager.broadcastToAllWindows("coding-language-changed", {
                    language: settings.codingLanguage,
                });
            }
            if (settings.activeSkill) {
                this.activeSkill = settings.activeSkill;
                windowManager.broadcastToAllWindows("skill-updated", {
                    skill: settings.activeSkill,
                });
            }
            if (settings.appIcon) {
                this.appIcon = settings.appIcon;
            }

            if (settings.selectedIcon) {
                this.appIcon = settings.selectedIcon;
                this.updateAppIcon(settings.selectedIcon);
            }

            this.persistSettings(settings);

            logger.info("Settings saved successfully", settings);
            return { success: true };
        } catch (error) {
            logger.error("Failed to save settings", { error: error.message });
            return { success: false, error: error.message };
        }
    }

    persistSettings(settings) {
        logger.debug("Settings persisted", settings);
    }

    updateAppIcon(iconKey) {
        try {
            const { app } = require("electron");
            const fs = require("fs");

            const iconPaths = {
                terminal: "assests/icons/terminal.png",
                activity: "assests/icons/activity.png",
                settings: "assests/icons/settings.png",
            };

            const appNames = {
                terminal: "Terminal ",
                activity: "Activity Monitor ",
                settings: "System Settings ",
            };

            const iconPath = iconPaths[iconKey];
            const appName = appNames[iconKey];

            if (!iconPath) {
                logger.error("Invalid icon key", { iconKey });
                return { success: false, error: "Invalid icon key" };
            }

            const fullIconPath = path.resolve(iconPath);

            if (!fs.existsSync(fullIconPath)) {
                logger.error("Icon file not found", {
                    iconKey,
                    iconPath: fullIconPath,
                });
                return { success: false, error: "Icon file not found" };
            }

            if (process.platform === "darwin") {
                app.dock.setIcon(fullIconPath);

                setTimeout(() => {
                    app.dock.setIcon(fullIconPath);
                }, 100);

                setTimeout(() => {
                    app.dock.setIcon(fullIconPath);
                }, 500);
            } else {
                windowManager.windows.forEach((window, type) => {
                    if (window && !window.isDestroyed()) {
                        window.setIcon(fullIconPath);
                    }
                });
            }

            this.updateAppName(appName, iconKey);

            logger.info("App icon and name updated successfully", {
                iconKey,
                appName,
                iconPath: fullIconPath,
                platform: process.platform,
                fileExists: fs.existsSync(fullIconPath),
            });

            this.appIcon = iconKey;
            return { success: true };
        } catch (error) {
            logger.error("Failed to update app icon", {
                error: error.message,
                stack: error.stack,
            });
            return { success: false, error: error.message };
        }
    }

    updateAppName(appName, iconKey) {
        try {
            const { app } = require("electron");

            process.title = appName;

            if (process.platform === "darwin") {
                app.setName(appName);

                const { execSync } = require("child_process");
                try {
                  if (process.mainModule && process.mainModule.filename) {
                    const appPath = process.mainModule.filename;
                    process.env.CFBundleName = appName.trim();
                  }
                } catch (e) {}

                if (app.dock) {
                    app.dock.setBadge("");
                    setTimeout(() => {
                        app.dock.setIcon(require("path").resolve(`assests/icons/${iconKey}.png`));
                    }, 50);
                }
            }

            app.setAppUserModelId(`${appName.trim()}-${iconKey}`);

            const windows = windowManager.windows;
            windows.forEach((window, type) => {
                if (window && !window.isDestroyed()) {
                    const stealthTitle = appName.trim();
                    window.setTitle(stealthTitle);
                }
            });

            const refreshTimes = [50, 100, 200, 500];
            refreshTimes.forEach((delay) => {
                setTimeout(() => {
                    process.title = appName;
                    if (process.platform === "darwin") {
                        app.setName(appName);
                        if (app.getName() !== appName) {
                            app.setName(appName);
                        }
                    }
                }, delay);
            });

            logger.info("App name updated for stealth mode", {
                appName,
                processTitle: process.title,
                appGetName: app.getName(),
                iconKey,
                platform: process.platform,
            });
        } catch (error) {
            logger.error("Failed to update app name", { error: error.message });
        }
    }

    async transcribeAudio(audioBuffer) {
        const audio = {
            content: audioBuffer.toString("base64"),
        };

        const config = {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: "en-US",
        };

        const request = {
            audio: audio,
            config: config,
        };

        try {
            const [response] = await client.recognize(request);
            const transcription = response.results
                .map((result) => result.alternatives[0].transcript)
                .join("\n");
            console.log(`Transcription: ${transcription}`);
            return transcription;
        } catch (error) {
            console.error("Error during transcription:", error);
            throw error;
        }
    }

    startWriteMode() {
        // Use TypingSimulator for real key events (robotjs)
        try {
            this.typingSimulator.typeClipboard().then((started) => {
                if (started) {
                    logger.info('Write mode activated. Typing clipboard content using TypingSimulator.');
                } else {
                    logger.warn('Clipboard is empty or contains non-text content. Write mode not activated.');
                }
            }).catch((e) => logger.error('TypingSimulator failed in write mode', { error: e.message }));
        } catch (error) {
            logger.error('Failed to activate write mode', { error: error.message });
        }
    }

    

    async simulateTypeCharByChar(text, delayMs = 1, batchSize = 10) { // Reduced delay and implemented a smart batch system
        const str = String(text ?? "");

        try {
            if (windowManager && typeof windowManager.hideAllWindows === 'function') {
                windowManager.hideAllWindows();
            }
        } catch (e) {}

        const sendBatch = async (batch) => {
            try {
                const escBatch = batch.replace(/'/g, "''");
                const psCmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escBatch}');`;
                const command = `powershell -NoProfile -WindowStyle Hidden -Command \"${psCmd.replace(/\"/g, '\\\"')}\"`;
                await new Promise((resolve, reject) => {
                    require('child_process').exec(command, { shell: true }, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            } catch (error) {
                logger.error('Failed to send batch', { batch, error: error.message });
            }
        };

        let batch = "";
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            try {
                if (ch === '\n') {
                    await sendBatch(batch);
                    batch = "";
                    await sendBatch('{ENTER}');
                } else if (ch === '\t') {
                    await sendBatch(batch);
                    batch = "";
                    await sendBatch('{TAB}');
                } else {
                    batch += ch;
                    if (batch.length >= batchSize) {
                        await sendBatch(batch);
                        batch = "";
                    }
                }
            } catch (e) {
                logger.error('Batch typing failed', { index: i, char: ch, error: e.message });
            }

            // Smart delay: Simulate human-like typing speed with slight randomness
            const humanLikeDelay = delayMs + Math.random() * 5; // Add slight randomness to delay
            if (humanLikeDelay > 0) await new Promise((r) => setTimeout(r, humanLikeDelay));
        }

        if (batch.length > 0) {
            await sendBatch(batch);
        }

        logger.info('simulateTypeCharByChar completed with smart batch typing', { length: str.length });
        return true;
    }

    
}

const appController = new ApplicationController();

module.exports = appController;